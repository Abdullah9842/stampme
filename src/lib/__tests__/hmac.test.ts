import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    ENROLLMENT_HMAC_SECRET: "a".repeat(64),
    NEXT_PUBLIC_APP_URL: "https://stampme.com",
  },
}));

import { signEnrollmentUrl, verifyEnrollmentSignature } from "@/lib/hmac";

describe("HMAC enrollment URLs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T10:00:00Z"));
  });
  afterAll(() => vi.useRealTimers());

  it("signs and verifies a fresh URL", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const u = new URL(url);
    const sig = u.searchParams.get("sig")!;
    const expParam = Number(u.searchParams.get("exp")!);
    expect(verifyEnrollmentSignature("acme-cafe", expParam, sig)).toBe(true);
  });

  it("rejects tampered slug", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const sig = new URL(url).searchParams.get("sig")!;
    expect(verifyEnrollmentSignature("evil-cafe", exp, sig)).toBe(false);
  });

  it("rejects tampered exp", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const sig = new URL(url).searchParams.get("sig")!;
    expect(verifyEnrollmentSignature("acme-cafe", exp + 1, sig)).toBe(false);
  });

  it("rejects expired URL", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const sig = new URL(url).searchParams.get("sig")!;
    vi.setSystemTime(new Date("2026-04-29T10:00:00Z"));
    expect(verifyEnrollmentSignature("acme-cafe", exp, sig)).toBe(false);
  });

  it("rejects malformed sig", () => {
    expect(verifyEnrollmentSignature("acme-cafe", Date.now() + 1000, "not-base64!")).toBe(false);
  });
});
