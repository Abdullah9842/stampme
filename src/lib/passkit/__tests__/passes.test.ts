import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

vi.mock("jose", () => ({
  SignJWT: vi.fn().mockImplementation(function () {
    return {
      setProtectedHeader: vi.fn().mockReturnThis(),
      setIssuedAt: vi.fn().mockReturnThis(),
      setExpirationTime: vi.fn().mockReturnThis(),
      setIssuer: vi.fn().mockReturnThis(),
      sign: vi.fn().mockResolvedValue("test-jwt"),
    };
  }),
  importPKCS8: vi.fn().mockResolvedValue("mock-key"),
}));

vi.mock("@/lib/env", () => ({
  env: {
    PASSKIT_API_URL: "https://api.pub1.passkit.io",
    PASSKIT_API_KEY: "pk_test_stub",
    PASSKIT_PUBLIC_KEY: "stub",
    PASSKIT_PRIVATE_KEY: "stub",
    PASSKIT_WEBHOOK_SECRET: "whsec_stub",
    NODE_ENV: "test",
  },
}));

const { findUniqueProgram, findUniquePass, createPass } = vi.hoisted(() => ({
  findUniqueProgram: vi.fn().mockResolvedValue({ id: "lp_1", passKitProgramId: "prg_1", stampsRequired: 10 }),
  findUniquePass: vi.fn().mockResolvedValue({ id: "p_1", passKitPassId: "psk_x", program: { stampsRequired: 10 } }),
  createPass: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    loyaltyProgram: { findUnique: findUniqueProgram },
    pass: { findUnique: findUniquePass, create: createPass },
  },
}));

import { server } from "./msw-server";
import { issuePass, markRedeemed, updatePassStamps, flagPassIssueFailure } from "../passes";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("issuePass", () => {
  it("creates a member with phone identifier and returns wallet URLs", async () => {
    server.use(
      http.post("https://api.pub1.passkit.io/members/member", async ({ request }) => {
        expect(request.headers.get("idempotency-key")).toBe("idem-12345");
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.programId).toBe("prg_1");
        expect((body.person as Record<string, unknown>).phone).toBe("+966501234567");
        return HttpResponse.json({
          id: "psk_x",
          links: {
            apple: "https://pub1.pskt.io/psk_x?type=apple",
            google: "https://pub1.pskt.io/psk_x?type=google",
          },
        });
      }),
    );
    const res = await issuePass({
      programId: "prg_1",
      customerPhone: "+966501234567",
      idempotencyKey: "idem-12345",
    });
    expect(res.passKitPassId).toBe("psk_x");
    expect(res.applePassUrl).toContain("apple");
    expect(res.googleWalletUrl).toContain("google");
  });
});

describe("updatePassStamps", () => {
  it("PUTs member with stamps field", async () => {
    server.use(
      http.put("https://api.pub1.passkit.io/members/member/psk_x", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect((body.fields as Record<string, unknown>).stamps).toBe("3/10");
        return HttpResponse.json({ ok: true });
      }),
    );
    await updatePassStamps({ passKitPassId: "psk_x", stampsCount: 3, idempotencyKey: "stamp-3-psk_x" });
  });
});

describe("markRedeemed", () => {
  it("resets stamps to 0 + tags redemption", async () => {
    server.use(
      http.put("https://api.pub1.passkit.io/members/member/psk_x", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect((body.fields as Record<string, unknown>).stamps).toBe("0/10");
        expect((body.metadata as Record<string, unknown>).lastRedemptionAt).toBeTruthy();
        return HttpResponse.json({ ok: true });
      }),
    );
    await markRedeemed({ passKitPassId: "psk_x", idempotencyKey: "redeem-psk_x-1" });
  });
});

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
});
