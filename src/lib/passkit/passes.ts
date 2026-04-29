import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  type IssuePassOutput,
  PassKitError,
  PassKitErrorCode,
} from "./types";

// ---------------------------------------------------------------------------
// STUB — gRPC implementation deferred to Plan 4/5
//
// issuePass, updatePassStamps, and markRedeemed are intentional stubs.
// They throw PassKitError(UNKNOWN) so callers get a typed, catchable error
// rather than a silent no-op or an unrelated exception.
//
// flagPassIssueFailure is NOT a PassKit call — it only writes to our DB —
// so it is fully implemented here.
// ---------------------------------------------------------------------------

const STUB_ERROR = new PassKitError({
  code: PassKitErrorCode.UNKNOWN,
  message: "passes.ts: gRPC implementation pending Plan 4/5",
});

export async function issuePass(
  _input: unknown,
): Promise<IssuePassOutput> {
  throw STUB_ERROR;
}

export async function updatePassStamps(_input: unknown): Promise<void> {
  throw STUB_ERROR;
}

export async function markRedeemed(_input: unknown): Promise<void> {
  throw STUB_ERROR;
}

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
