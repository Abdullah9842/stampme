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
// PassKit gRPC client mock
// ---------------------------------------------------------------------------
const enrolMember = vi.fn();
const updateMember = vi.fn();
const getMemberRecordById = vi.fn();

vi.mock("../client", () => ({
  passkitGrpc: () => ({
    members: { enrolMember, updateMember, getMemberRecordById },
  }),
}));

// ---------------------------------------------------------------------------
// DB mock (for updatePassStamps, markRedeemed, flagPassIssueFailure)
// ---------------------------------------------------------------------------
const { createPass, findUniquePass } = vi.hoisted(() => ({
  createPass: vi.fn(),
  findUniquePass: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    pass: {
      create: createPass,
      findUnique: findUniquePass,
    },
  },
}));

import { issuePass, markRedeemed, updatePassStamps, flagPassIssueFailure } from "../passes";
import { PassKitError, PassKitErrorCode } from "../types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// issuePass — real gRPC impl
// ---------------------------------------------------------------------------

describe("issuePass", () => {
  it("returns wallet URLs from enrolMember response (Smart Pass URL pattern)", async () => {
    enrolMember.mockImplementation((_req: unknown, cb: (err: null, res: { getId: () => string }) => void) => {
      cb(null, { getId: () => "pk_member_abc123" });
    });

    const result = await issuePass({
      programId: "prog_xyz",
      customerPhone: "+966501234567",
    });

    expect(result.passKitPassId).toBe("pk_member_abc123");
    expect(result.applePassUrl).toBe("https://pub1.pskt.io/pk_member_abc123");
    expect(result.googleWalletUrl).toBe("https://pub1.pskt.io/pk_member_abc123");
  });

  it("calls enrolMember with correct programId, tierId, and phone", async () => {
    enrolMember.mockImplementation((_req: unknown, cb: (err: null, res: { getId: () => string }) => void) => {
      cb(null, { getId: () => "pk_member_xyz" });
    });

    await issuePass({
      programId: "prog_abc",
      customerPhone: "+966501234567",
    });

    expect(enrolMember).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [memberArg] = enrolMember.mock.calls[0]!;
    // Verify the Member proto was configured correctly
    expect(memberArg.getProgramid()).toBe("prog_abc");
    expect(memberArg.getTierid()).toBe("tier-prog_abc");
    expect(memberArg.getPoints()).toBe(0);
    expect(memberArg.getPerson().getMobilenumber()).toBe("+966501234567");
    expect(memberArg.getPerson().getDisplayname()).toBe("+966501234567");
  });

  it("throws CONFLICT if PassKit returns gRPC ALREADY_EXISTS (code 6)", async () => {
    enrolMember.mockImplementation((_req: unknown, cb: (err: { code: number }, res: null) => void) => {
      cb({ code: 6 }, null);
    });

    const err = await issuePass({
      programId: "prog_abc",
      customerPhone: "+966501234567",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.CONFLICT);
    expect(err.message).toContain("already enrolled");
  });

  it("throws UPSTREAM if enrolMember returns empty member ID", async () => {
    enrolMember.mockImplementation((_req: unknown, cb: (err: null, res: { getId: () => string }) => void) => {
      cb(null, { getId: () => "" });
    });

    const err = await issuePass({
      programId: "prog_abc",
      customerPhone: "+966501234567",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.UPSTREAM);
  });

  it("throws VALIDATION for invalid phone number", async () => {
    const err = await issuePass({
      programId: "prog_abc",
      customerPhone: "not-a-phone",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.VALIDATION);
  });

  it("auto-derives idempotencyKey when not provided", async () => {
    enrolMember.mockImplementation((_req: unknown, cb: (err: null, res: { getId: () => string }) => void) => {
      cb(null, { getId: () => "pk_derived" });
    });

    // Should not throw — idempotencyKey is optional now
    const result = await issuePass({
      programId: "prog_abc",
      customerPhone: "+966501234567",
      // no idempotencyKey
    });
    expect(result.passKitPassId).toBe("pk_derived");
  });
});

// ---------------------------------------------------------------------------
// updatePassStamps
// ---------------------------------------------------------------------------

describe("updatePassStamps", () => {
  it("calls updateMember with correct programId, tierId, and stamp count", async () => {
    findUniquePass.mockResolvedValue({
      passKitPassId: "pk_pass_1",
      program: { passKitProgramId: "prog_x" },
    });
    updateMember.mockImplementation((_req: unknown, cb: (err: null, res: { getId: () => string }) => void) => {
      cb(null, { getId: () => "pk_pass_1" });
    });

    await updatePassStamps({
      passKitPassId: "pk_pass_1",
      stampsCount: 5,
      idempotencyKey: "stamp-5-pk_pass_1",
    });

    expect(updateMember).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [memberArg] = updateMember.mock.calls[0]!;
    expect(memberArg.getId()).toBe("pk_pass_1");
    expect(memberArg.getProgramid()).toBe("prog_x");
    expect(memberArg.getTierid()).toBe("tier-prog_x");
    expect(memberArg.getPoints()).toBe(5);
  });

  it("throws NOT_FOUND if pass not in DB", async () => {
    findUniquePass.mockResolvedValue(null);

    const err = await updatePassStamps({
      passKitPassId: "pk_missing",
      stampsCount: 3,
      idempotencyKey: "stamp-3-pk_missing",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// markRedeemed
// ---------------------------------------------------------------------------

describe("markRedeemed", () => {
  it("calls updateMember with points=0 and sets lastRedemptionAt metadata", async () => {
    findUniquePass.mockResolvedValue({
      passKitPassId: "pk_redeem_1",
      program: { passKitProgramId: "prog_y" },
    });
    updateMember.mockImplementation((_req: unknown, cb: (err: null, res: { getId: () => string }) => void) => {
      cb(null, { getId: () => "pk_redeem_1" });
    });

    await markRedeemed({
      passKitPassId: "pk_redeem_1",
      idempotencyKey: "redeem-pk_redeem_1-1",
    });

    expect(updateMember).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [memberArg] = updateMember.mock.calls[0]!;
    expect(memberArg.getId()).toBe("pk_redeem_1");
    expect(memberArg.getProgramid()).toBe("prog_y");
    expect(memberArg.getTierid()).toBe("tier-prog_y");
    expect(memberArg.getPoints()).toBe(0); // stamps reset to 0 on redemption

    // Metadata should include lastRedemptionAt
    const metaMap = memberArg.getMetadataMap?.();
    if (metaMap) {
      // getMetadataMap returns a jspb Map — check if key was set
      expect(typeof metaMap.get("lastRedemptionAt")).toBe("string");
    }
  });

  it("throws NOT_FOUND if pass not in DB", async () => {
    findUniquePass.mockResolvedValue(null);

    const err = await markRedeemed({
      passKitPassId: "pk_missing",
      idempotencyKey: "redeem-pk_missing-1",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PassKitError);
    expect(err.code).toBe(PassKitErrorCode.NOT_FOUND);
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
