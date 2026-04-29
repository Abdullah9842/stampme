import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/env", () => ({
  env: { PASSKIT_WEBHOOK_SECRET: "whsec_test" },
}));

import { verifyPassKitSignature } from "../webhooks";
import { PassKitError } from "../types";

const sign = (body: string, ts: string) =>
  "sha256=" + createHmac("sha256", "whsec_test").update(`${ts}.${body}`).digest("hex");

describe("verifyPassKitSignature", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-04-28T10:00:00Z")));
  afterAll(() => vi.useRealTimers());

  it("accepts a valid signature within tolerance", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"event":"pass.installed"}';
    expect(() =>
      verifyPassKitSignature({ rawBody: body, signature: sign(body, ts), timestamp: ts }),
    ).not.toThrow();
  });

  it("rejects tampered body", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign('{"event":"pass.installed"}', ts);
    expect(() =>
      verifyPassKitSignature({ rawBody: '{"event":"pass.removed"}', signature: sig, timestamp: ts }),
    ).toThrow(PassKitError);
  });

  it("rejects wrong secret signature", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const bad = "sha256=" + createHmac("sha256", "wrong").update(`${ts}.{}`).digest("hex");
    expect(() => verifyPassKitSignature({ rawBody: "{}", signature: bad, timestamp: ts }))
      .toThrow(PassKitError);
  });

  it("rejects timestamp older than 5 minutes", () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const body = "{}";
    expect(() => verifyPassKitSignature({ rawBody: body, signature: sign(body, oldTs), timestamp: oldTs }))
      .toThrow(/timestamp/i);
  });

  it("rejects malformed signature header", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() => verifyPassKitSignature({ rawBody: "{}", signature: "garbage", timestamp: ts }))
      .toThrow(PassKitError);
  });
});
