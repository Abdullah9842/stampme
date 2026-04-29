import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Env mock
// ---------------------------------------------------------------------------
vi.mock("@/lib/env", () => ({
  env: {
    PASSKIT_CERTIFICATE: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
    PASSKIT_KEY: "-----BEGIN EC PRIVATE KEY-----\nfake\n-----END EC PRIVATE KEY-----",
    PASSKIT_CA_CHAIN: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
    PASSKIT_WEBHOOK_SECRET: "whsec_stub",
    NODE_ENV: "test",
  },
}));

// ---------------------------------------------------------------------------
// DB mock (for flagPassIssueFailure only)
// ---------------------------------------------------------------------------
const { createPass } = vi.hoisted(() => ({
  createPass: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    pass: { create: createPass },
  },
}));

import { issuePass, markRedeemed, updatePassStamps, flagPassIssueFailure } from "../passes";
import { PassKitError, PassKitErrorCode } from "../types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Stub behaviour assertions
// The three pass operation functions are STUB IMPL ONLY pending Plan 4/5.
// They must throw PassKitError with code UNKNOWN.
// ---------------------------------------------------------------------------

describe("issuePass — stub", () => {
  it("throws PassKitError with code UNKNOWN", async () => {
    const err = await issuePass({
      programId: "prg_1",
      customerPhone: "+966501234567",
      idempotencyKey: "idem-12345",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.UNKNOWN);
    expect(err.message).toContain("pending Plan 4/5");
  });
});

describe("updatePassStamps — stub", () => {
  it("throws PassKitError with code UNKNOWN", async () => {
    const err = await updatePassStamps({
      passKitPassId: "psk_x",
      stampsCount: 3,
      idempotencyKey: "stamp-3-psk_x",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.UNKNOWN);
  });
});

describe("markRedeemed — stub", () => {
  it("throws PassKitError with code UNKNOWN", async () => {
    const err = await markRedeemed({
      passKitPassId: "psk_x",
      idempotencyKey: "redeem-psk_x-1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.UNKNOWN);
  });
});

// ---------------------------------------------------------------------------
// flagPassIssueFailure — DB-only, fully implemented
// ---------------------------------------------------------------------------
describe("flagPassIssueFailure", () => {
  it("writes a Pass row with ISSUE_FAILED status", async () => {
    createPass.mockResolvedValue({ id: "p_failed" });
    await flagPassIssueFailure({
      programId: "lp_1",
      customerPhone: "+966500000000",
      reason: "upstream 500",
    });
    expect(createPass).toHaveBeenCalledWith({
      data: expect.objectContaining({
        programId: "lp_1",
        customerPhone: "+966500000000",
        status: "ISSUE_FAILED",
        stampsCount: 0,
        passKitPassId: expect.stringMatching(/^failed_/),
      }),
    });
  });

  it("propagates DB errors without wrapping", async () => {
    createPass.mockRejectedValue(new Error("DB connection lost"));
    await expect(
      flagPassIssueFailure({ programId: "lp_1", customerPhone: "+966500000000", reason: "x" }),
    ).rejects.toThrow("DB connection lost");
  });
});
