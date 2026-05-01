import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/env", () => ({
  env: { MYFATOORAH_WEBHOOK_SECRET: "test_secret" },
}));

const { chargeFindFirst, chargeUpdate, paymentMethodDeleteMany } = vi.hoisted(() => ({
  chargeFindFirst: vi.fn(),
  chargeUpdate: vi.fn(),
  paymentMethodDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    charge: { findFirst: chargeFindFirst, update: chargeUpdate },
    paymentMethod: { deleteMany: paymentMethodDeleteMany },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { POST } from "../route";

function signedRequest(payload: Record<string, unknown>) {
  const data = (payload.Data ?? {}) as Record<string, unknown>;
  const signingString = Object.keys(data)
    .filter((k) => data[k] !== null && data[k] !== undefined)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join(",");
  const sig = createHmac("sha256", "test_secret").update(signingString).digest("base64");
  return new Request("http://test/api/webhooks/myfatoorah", {
    method: "POST",
    headers: { "content-type": "application/json", "myfatoorah-signature": sig },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  chargeFindFirst.mockReset();
  chargeUpdate.mockReset();
  paymentMethodDeleteMany.mockReset();
});

describe("POST /api/webhooks/myfatoorah", () => {
  it("400 on missing signature", async () => {
    const req = new Request("http://test/api/webhooks/myfatoorah", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ EventType: 1, Event: "x", Data: {} }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("marks charge SUCCEEDED on Paid invoice (EventType 1)", async () => {
    chargeFindFirst.mockResolvedValue({ id: "c_1", providerInvoiceId: "42" });
    const req = signedRequest({
      EventType: 1,
      Event: "TransactionsStatusChanged",
      Data: { InvoiceId: 42, InvoiceStatus: "Paid" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(chargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c_1" }, data: expect.objectContaining({ status: "SUCCEEDED" }) }),
    );
  });

  it("deletes PaymentMethod on recurring Cancelled (EventType 3)", async () => {
    paymentMethodDeleteMany.mockResolvedValue({ count: 1 });
    const req = signedRequest({
      EventType: 3,
      Event: "RecurringStatusChanged",
      Data: { RecurringId: "rec_abc", PaymentStatus: "Cancelled" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(paymentMethodDeleteMany).toHaveBeenCalledWith({ where: { recurringId: "rec_abc" } });
  });
});
