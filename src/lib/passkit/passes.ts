import { passkitClient } from "./client";
import { db } from "@/lib/db";
import {
  IssuePassInput,
  type IssuePassOutput,
  MarkRedeemedInput,
  PassKitError,
  PassKitErrorCode,
  UpdatePassStampsInput,
} from "./types";

export async function issuePass(input: IssuePassInput): Promise<IssuePassOutput> {
  const parsed = IssuePassInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({ code: PassKitErrorCode.VALIDATION, message: parsed.error.message });
  }
  const { programId, customerPhone, idempotencyKey } = parsed.data;

  const program = await db.loyaltyProgram.findUnique({
    where: { passKitProgramId: programId },
  });
  if (!program) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `LoyaltyProgram with passKitProgramId=${programId} not found`,
    });
  }

  const body = {
    programId,
    person: { phone: customerPhone },
    fields: { stamps: `0/${program.stampsRequired}` },
    metadata: { phone: customerPhone, app: "stampme" },
  };

  const res = await passkitClient.request<{
    id: string;
    links: { apple: string; google: string };
  }>("POST", "/members/member", { body, idempotencyKey });

  if (!res?.id || !res.links?.apple || !res.links?.google) {
    throw new PassKitError({
      code: PassKitErrorCode.UPSTREAM,
      message: "issuePass: missing id or wallet links",
      upstream: res,
    });
  }

  return {
    passKitPassId: res.id,
    applePassUrl: res.links.apple,
    googleWalletUrl: res.links.google,
  };
}

export async function updatePassStamps(input: UpdatePassStampsInput): Promise<void> {
  const parsed = UpdatePassStampsInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({ code: PassKitErrorCode.VALIDATION, message: parsed.error.message });
  }
  const { passKitPassId, stampsCount, idempotencyKey } = parsed.data;

  const pass = await db.pass.findUnique({
    where: { passKitPassId },
    include: { program: true },
  });
  if (!pass) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `Pass passKitPassId=${passKitPassId} not in DB`,
    });
  }

  await passkitClient.request<unknown>(
    "PUT",
    `/members/member/${encodeURIComponent(passKitPassId)}`,
    {
      body: {
        fields: { stamps: `${stampsCount}/${pass.program.stampsRequired}` },
        metadata: { stampsCount },
      },
      idempotencyKey,
    },
  );
}

export async function markRedeemed(input: MarkRedeemedInput): Promise<void> {
  const parsed = MarkRedeemedInput.safeParse(input);
  if (!parsed.success) {
    throw new PassKitError({ code: PassKitErrorCode.VALIDATION, message: parsed.error.message });
  }
  const { passKitPassId, idempotencyKey } = parsed.data;

  const pass = await db.pass.findUnique({
    where: { passKitPassId },
    include: { program: true },
  });
  if (!pass) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `Pass ${passKitPassId} not found`,
    });
  }

  await passkitClient.request<unknown>(
    "PUT",
    `/members/member/${encodeURIComponent(passKitPassId)}`,
    {
      body: {
        fields: { stamps: `0/${pass.program.stampsRequired}` },
        metadata: {
          stampsCount: 0,
          lastRedemptionAt: new Date().toISOString(),
        },
      },
      idempotencyKey,
    },
  );
}
