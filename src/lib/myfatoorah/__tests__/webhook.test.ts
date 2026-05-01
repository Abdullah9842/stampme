import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/env", () => ({
  env: { MYFATOORAH_WEBHOOK_SECRET: "test_secret" },
}));

import { verifyMyFatoorahSignature } from "@/lib/myfatoorah/webhook";
import { MyFatoorahError } from "@/lib/myfatoorah/types";

function sign(data: Record<string, unknown>): string {
  const signingString = Object.keys(data)
    .filter((k) => data[k] !== null && data[k] !== undefined)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join(",");
  return createHmac("sha256", "test_secret").update(signingString).digest("base64");
}

describe("verifyMyFatoorahSignature", () => {
  it("passes on valid signature", () => {
    const payload = { EventType: 1, Data: { InvoiceId: 42, InvoiceStatus: "Paid" } };
    const sig = sign(payload.Data);
    expect(() => verifyMyFatoorahSignature({ payload, signature: sig })).not.toThrow();
  });

  it("throws on missing signature", () => {
    expect(() => verifyMyFatoorahSignature({ payload: { Data: {} }, signature: null }))
      .toThrow(MyFatoorahError);
  });

  it("throws on tampered payload", () => {
    const payload = { Data: { InvoiceId: 42, InvoiceStatus: "Paid" } };
    const sig = sign(payload.Data);
    const tamperedPayload = { Data: { InvoiceId: 42, InvoiceStatus: "Failed" } };
    expect(() => verifyMyFatoorahSignature({ payload: tamperedPayload, signature: sig }))
      .toThrow(MyFatoorahError);
  });

  it("throws on wrong secret", () => {
    const payload = { Data: { InvoiceId: 42 } };
    const wrongSig = createHmac("sha256", "different").update("InvoiceId=42").digest("base64");
    expect(() => verifyMyFatoorahSignature({ payload, signature: wrongSig }))
      .toThrow(MyFatoorahError);
  });
});
