import { randomUUID, createHash } from "node:crypto";
import { db } from "@/lib/db";
import {
  IssuePassInput,
  type IssuePassOutput,
  MarkRedeemedInput,
  PassKitError,
  PassKitErrorCode,
  UpdatePassStampsInput,
} from "./types";
import { passkitGrpc } from "./client";
import { Member } from "passkit-node-sdk/io/member/member_pb";
import { Person } from "passkit-node-sdk/io/common/personal_pb";
import { Id } from "passkit-node-sdk/io/common/common_objects_pb";

// ---------------------------------------------------------------------------
// Generic gRPC callback → Promise adapter (same pattern as programs.ts)
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function promisify<TReq = any, TRes = any>(
  fn: (req: TReq, cb: (err: Error | null, res: TRes) => void) => void,
  req: TReq,
): Promise<TRes> {
  return new Promise((resolve, reject) =>
    fn(req, (err, res) => (err ? reject(err) : resolve(res))),
  );
}

// ---------------------------------------------------------------------------
// Tier ID convention — must match createProgram in programs.ts
// ---------------------------------------------------------------------------
function defaultTierId(passKitProgramId: string): string {
  return `tier-${passKitProgramId}`;
}

// ---------------------------------------------------------------------------
// Deterministic idempotency key — same phone+program → same key
// ---------------------------------------------------------------------------
function deriveIdempotencyKey(programId: string, phone: string): string {
  return createHash("sha256")
    .update(`${programId}|${phone}`)
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Smart Pass URL construction
//
// enrolMember returns an Id message — it has getId() only, no passUrl.
// getMemberRecordById returns a Member — Member proto also has no passUrl field.
// The PassKit smart-pass URL is always: https://pub1.pskt.io/{memberId}
// This URL auto-detects Apple Wallet vs Google Wallet on device.
// ---------------------------------------------------------------------------
function buildPassUrl(passKitPassId: string): string {
  return `https://pub1.pskt.io/${passKitPassId}`;
}

// ---------------------------------------------------------------------------
// issuePass
//
// Enrolls a phone number into a PassKit loyalty program.
// Returns wallet URLs (same Smart Pass URL for both Apple and Google).
// ---------------------------------------------------------------------------
export async function issuePass(input: unknown): Promise<IssuePassOutput> {
  // Auto-derive idempotencyKey if not provided
  const raw = input as Record<string, unknown>;
  const inputWithKey = {
    idempotencyKey: raw?.idempotencyKey ?? deriveIdempotencyKey(
      String(raw?.programId ?? ""),
      String(raw?.customerPhone ?? ""),
    ),
    ...raw,
  };

  const parsed = IssuePassInput.safeParse(inputWithKey);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { programId: passKitProgramId, customerPhone } = parsed.data;

  const grpcClient = passkitGrpc();

  // Build Person proto — setMobilenumber is the verified method name in personal_pb.js
  const person = new Person();
  person.setMobilenumber(customerPhone);
  person.setDisplayname(customerPhone); // PassKit requires a displayname; phone is fine for MVP

  // Build Member proto
  const member = new Member();
  member
    .setTierid(defaultTierId(passKitProgramId))
    .setProgramid(passKitProgramId)
    .setPerson(person)
    .setPoints(0);

  // Tag with app metadata if the metadataMap is available
  const metadataMap = member.getMetadataMap?.();
  if (metadataMap) {
    metadataMap.set("app", "stampme");
    metadataMap.set("phone", customerPhone);
  }

  // enrolMember returns Id (only getId()) — confirmed from a_rpc_grpc_pb.js
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let enrolResponse: any;
  try {
    enrolResponse = await promisify(
      grpcClient.members.enrolMember.bind(grpcClient.members),
      member,
    );
  } catch (err: unknown) {
    const grpcErr = err as { code?: number; message?: string };
    // gRPC ALREADY_EXISTS = code 6 — member already enrolled
    if (grpcErr?.code === 6) {
      throw new PassKitError({
        code: PassKitErrorCode.CONFLICT,
        message: `Member already enrolled: ${customerPhone}`,
        cause: err,
      });
    }
    throw err;
  }

  // enrolMember response is an Id message — only getId() is available
  const passKitPassId: string = enrolResponse?.getId?.() ?? "";

  if (!passKitPassId) {
    throw new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "issuePass: PassKit returned no member ID",
      upstream: enrolResponse,
    });
  }

  // Smart Pass URL — same URL serves both Apple Wallet and Google Wallet
  const passUrl = buildPassUrl(passKitPassId);

  return {
    passKitPassId,
    applePassUrl: passUrl,
    googleWalletUrl: passUrl,
  };
}

// ---------------------------------------------------------------------------
// updatePassStamps
//
// Updates the stamp count on an existing pass via updateMember().
// ---------------------------------------------------------------------------
export async function updatePassStamps(input: unknown): Promise<void> {
  const parsed = UpdatePassStampsInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { passKitPassId, stampsCount } = parsed.data;

  // Look up Pass row to get programId for the fully-qualified Member proto
  const pass = await db.pass.findUnique({
    where: { passKitPassId },
    include: { program: true },
  });
  if (!pass) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `Pass ${passKitPassId} not in DB`,
    });
  }
  if (!pass.program.passKitProgramId) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: "LoyaltyProgram has no passKitProgramId yet",
    });
  }

  const grpcClient = passkitGrpc();
  const member = new Member();
  member
    .setId(passKitPassId)
    .setProgramid(pass.program.passKitProgramId)
    .setTierid(defaultTierId(pass.program.passKitProgramId))
    .setPoints(stampsCount);

  await promisify(
    grpcClient.members.updateMember.bind(grpcClient.members),
    member,
  );
}

// ---------------------------------------------------------------------------
// markRedeemed
//
// Resets stamps to 0 and tags redemption time in member metadata.
// ---------------------------------------------------------------------------
export async function markRedeemed(input: unknown): Promise<void> {
  const parsed = MarkRedeemedInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({
      code: PassKitErrorCode.VALIDATION,
      message: parsed.error.message,
    });
  }
  const { passKitPassId } = parsed.data;

  const pass = await db.pass.findUnique({
    where: { passKitPassId },
    include: { program: true },
  });
  if (!pass) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `Pass ${passKitPassId} not in DB`,
    });
  }
  if (!pass.program.passKitProgramId) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: "Program not synced to PassKit",
    });
  }

  const grpcClient = passkitGrpc();
  const member = new Member();
  member
    .setId(passKitPassId)
    .setProgramid(pass.program.passKitProgramId)
    .setTierid(defaultTierId(pass.program.passKitProgramId))
    .setPoints(0); // Reset stamps to 0 on redemption

  const metadataMap = member.getMetadataMap?.();
  if (metadataMap) {
    metadataMap.set("lastRedemptionAt", new Date().toISOString());
  }

  await promisify(
    grpcClient.members.updateMember.bind(grpcClient.members),
    member,
  );
}

// ---------------------------------------------------------------------------
// flagPassIssueFailure — DB-only, no PassKit call (unchanged from Plan 3)
// ---------------------------------------------------------------------------
export async function flagPassIssueFailure(opts: {
  programId: string;
  customerPhone: string;
  reason: string;
}): Promise<void> {
  await db.pass.create({
    data: {
      programId: opts.programId,
      customerPhone: opts.customerPhone,
      passKitPassId: `failed_${randomUUID()}`,
      status: "ISSUE_FAILED",
      stampsCount: 0,
    },
  });
}

// Re-export Id for consumers that need it (e.g. plan-5 getMember lookups)
export { Id };
