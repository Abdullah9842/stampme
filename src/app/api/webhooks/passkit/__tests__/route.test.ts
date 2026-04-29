import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/env", () => ({ env: { PASSKIT_WEBHOOK_SECRET: "whsec_test" } }));

const { updatePass, captureEvent } = vi.hoisted(() => ({
  updatePass: vi.fn(),
  captureEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { pass: { update: updatePass, findUnique: vi.fn() } },
}));

vi.mock("@/lib/posthog", () => ({
  getPostHogServer: () => ({ capture: captureEvent, shutdown: vi.fn() }),
}));

import { POST } from "../route";

const buildReq = (body: object) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", "whsec_test").update(`${ts}.${raw}`).digest("hex");
  return new Request("http://test/api/webhooks/passkit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-passkit-signature": sig,
      "x-passkit-timestamp": ts,
    },
    body: raw,
  });
};

describe("POST /api/webhooks/passkit", () => {
  beforeEach(() => {
    updatePass.mockReset();
    captureEvent.mockReset();
  });

  it("400 on bad signature", async () => {
    const req = new Request("http://test/api/webhooks/passkit", {
      method: "POST",
      headers: { "x-passkit-signature": "sha256=00", "x-passkit-timestamp": String(Math.floor(Date.now()/1000)) },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("marks pass DELETED on pass.removed", async () => {
    const req = buildReq({
      event: "pass.removed",
      passId: "psk_1",
      programId: "prg_1",
      platform: "apple",
      timestamp: new Date().toISOString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(updatePass).toHaveBeenCalledWith({
      where: { passKitPassId: "psk_1" },
      data: { status: "DELETED" },
    });
  });

  it("captures PostHog event on pass.viewed", async () => {
    const req = buildReq({
      event: "pass.viewed",
      passId: "psk_1",
      programId: "prg_1",
      timestamp: new Date().toISOString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(captureEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "pass_viewed" }));
  });
});
