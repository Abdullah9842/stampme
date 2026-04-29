import { describe, it, expect, vi, beforeEach } from "vitest";

const { findManyMerchants, countPasses, sendEmail } = vi.hoisted(() => ({
  findManyMerchants: vi.fn(),
  countPasses: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { merchant: { findMany: findManyMerchants }, pass: { count: countPasses } },
}));
vi.mock("@/lib/email", () => ({ sendMarginAlert: sendEmail }));
vi.mock("@/lib/env", () => ({
  env: {
    CRON_SECRET: "secret123secret123secret123secret",
    MARGIN_PASS_COST_USD: 0.10,
    MARGIN_ALERT_EMAIL: "abdullah@stampme.com",
  },
}));

import { GET } from "../route";

beforeEach(() => {
  findManyMerchants.mockReset();
  countPasses.mockReset();
  sendEmail.mockReset();
});

describe("GET /api/cron/margin-alert", () => {
  it("401 without bearer", async () => {
    const res = await GET(new Request("http://test/api/cron/margin-alert"));
    expect(res.status).toBe(401);
  });

  it("alerts when cost > 60% of revenue", async () => {
    findManyMerchants.mockResolvedValue([
      { id: "m_1", name: "Brew Bros", subscription: { plan: "STARTER" }, programs: [{ id: "lp_1" }] },
    ]);
    countPasses.mockResolvedValue(200);
    const req = new Request("http://test/api/cron/margin-alert", {
      headers: { authorization: "Bearer secret123secret123secret123secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("does not alert when below threshold", async () => {
    findManyMerchants.mockResolvedValue([
      { id: "m_1", name: "Brew Bros", subscription: { plan: "STARTER" }, programs: [{ id: "lp_1" }] },
    ]);
    countPasses.mockResolvedValue(20);
    const req = new Request("http://test/api/cron/margin-alert", {
      headers: { authorization: "Bearer secret123secret123secret123secret" },
    });
    await GET(req);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
