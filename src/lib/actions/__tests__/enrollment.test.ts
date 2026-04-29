import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any imports that trigger module eval
// ---------------------------------------------------------------------------
const {
  merchantFindUnique,
  programFindFirst,
  passFindFirst,
  passCreate,
} = vi.hoisted(() => ({
  merchantFindUnique: vi.fn(),
  programFindFirst: vi.fn(),
  passFindFirst: vi.fn(),
  passCreate: vi.fn(),
}));

const { issuePassMock } = vi.hoisted(() => ({ issuePassMock: vi.fn() }));

const { enrollIpLimit, enrollPhoneLimit, recoverPhoneLimit } = vi.hoisted(() => ({
  enrollIpLimit: vi.fn(),
  enrollPhoneLimit: vi.fn(),
  recoverPhoneLimit: vi.fn(),
}));

const { verifySigMock } = vi.hoisted(() => ({ verifySigMock: vi.fn() }));

const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  db: {
    merchant: { findUnique: merchantFindUnique },
    loyaltyProgram: { findFirst: programFindFirst },
    pass: { findFirst: passFindFirst, create: passCreate },
  },
}));

vi.mock("@/lib/passkit/passes", () => ({
  issuePass: issuePassMock,
}));

vi.mock("@/lib/ratelimit", () => ({
  enrollIpLimiter: { limit: enrollIpLimit },
  enrollPhoneLimiter: { limit: enrollPhoneLimit },
  recoverPhoneLimiter: { limit: recoverPhoneLimit },
}));

vi.mock("@/lib/hmac", () => ({
  verifyEnrollmentSignature: verifySigMock,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]])),
}));

import { enrollCustomer, recoverPass } from "@/lib/actions/enrollment";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const MERCHANT = { id: "m_1", slug: "acme-cafe" };
const PROGRAM = { id: "lp_1", merchantId: "m_1", passKitProgramId: "prg_x" };
const ISSUED = {
  passKitPassId: "pk_pass_1",
  applePassUrl: "https://pub1.pskt.io/pk_pass_1",
  googleWalletUrl: "https://pub1.pskt.io/pk_pass_1",
};
const CREATED_PASS = { id: "pass_1", ...ISSUED };
const VALID_INPUT = { merchantSlug: "acme-cafe", phone: "+966512345678" };

// Default rate-limit: always allow
const ALLOW = { success: true, reset: 0 };
const DENY = { success: false, reset: Date.now() + 3_600_000 };

beforeEach(() => {
  vi.clearAllMocks();

  // Default: rate-limits allow
  enrollIpLimit.mockResolvedValue(ALLOW);
  enrollPhoneLimit.mockResolvedValue(ALLOW);
  recoverPhoneLimit.mockResolvedValue(ALLOW);

  // Default: no signature check needed
  verifySigMock.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// enrollCustomer
// ---------------------------------------------------------------------------
describe("enrollCustomer", () => {
  it("issues a new pass when none exists", async () => {
    merchantFindUnique.mockResolvedValue(MERCHANT);
    programFindFirst.mockResolvedValue(PROGRAM);
    passFindFirst.mockResolvedValue(null);
    issuePassMock.mockResolvedValue(ISSUED);
    passCreate.mockResolvedValue(CREATED_PASS);

    const result = await enrollCustomer(VALID_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.passId).toBe("pass_1");
      expect(result.alreadyEnrolled).toBe(false);
      expect(result.applePassUrl).toBe(ISSUED.applePassUrl);
    }
    expect(issuePassMock).toHaveBeenCalledOnce();
    expect(passCreate).toHaveBeenCalledOnce();
  });

  it("is idempotent — returns existing pass for same phone", async () => {
    merchantFindUnique.mockResolvedValue(MERCHANT);
    programFindFirst.mockResolvedValue(PROGRAM);
    const existingPass = { id: "pass_existing", ...ISSUED };
    passFindFirst.mockResolvedValue(existingPass);

    const result = await enrollCustomer(VALID_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.passId).toBe("pass_existing");
      expect(result.alreadyEnrolled).toBe(true);
    }
    expect(issuePassMock).not.toHaveBeenCalled();
    expect(passCreate).not.toHaveBeenCalled();
  });

  it("returns RATE_LIMITED when IP limit exceeded", async () => {
    enrollIpLimit.mockResolvedValue(DENY);

    const result = await enrollCustomer(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
    expect(merchantFindUnique).not.toHaveBeenCalled();
  });

  it("returns RATE_LIMITED when phone limit exceeded", async () => {
    enrollIpLimit.mockResolvedValue(ALLOW);
    enrollPhoneLimit.mockResolvedValue(DENY);

    const result = await enrollCustomer(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
    expect(merchantFindUnique).not.toHaveBeenCalled();
  });

  it("rejects unknown merchant (MERCHANT_NOT_FOUND)", async () => {
    merchantFindUnique.mockResolvedValue(null);

    const result = await enrollCustomer(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MERCHANT_NOT_FOUND");
  });

  it("rejects merchant without active program (PROGRAM_NOT_READY)", async () => {
    merchantFindUnique.mockResolvedValue(MERCHANT);
    programFindFirst.mockResolvedValue(null);

    const result = await enrollCustomer(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROGRAM_NOT_READY");
    expect(issuePassMock).not.toHaveBeenCalled();
  });

  it("validates phone — rejects garbage (VALIDATION)", async () => {
    const result = await enrollCustomer({ merchantSlug: "acme-cafe", phone: "not-a-phone" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
    expect(enrollIpLimit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// recoverPass
// ---------------------------------------------------------------------------
describe("recoverPass", () => {
  it("returns existing pass without re-issuing", async () => {
    merchantFindUnique.mockResolvedValue(MERCHANT);
    programFindFirst.mockResolvedValue(PROGRAM);
    const existingPass = { id: "pass_existing", ...ISSUED };
    passFindFirst.mockResolvedValue(existingPass);

    const result = await recoverPass(VALID_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applePassUrl).toBe(ISSUED.applePassUrl);
      expect(result.googleWalletUrl).toBe(ISSUED.googleWalletUrl);
    }
    expect(issuePassMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when no pass exists", async () => {
    merchantFindUnique.mockResolvedValue(MERCHANT);
    programFindFirst.mockResolvedValue(PROGRAM);
    passFindFirst.mockResolvedValue(null);

    const result = await recoverPass(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});
