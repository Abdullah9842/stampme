import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

// Mock env so Zod validation doesn't throw in test environment
vi.mock("@/lib/env", () => ({
  env: {
    PASSKIT_API_URL: "https://api.pub1.passkit.io",
    PASSKIT_API_KEY: "pk_test_stub",
    PASSKIT_API_SECRET: "stub-secret",
    PASSKIT_WEBHOOK_SECRET: "whsec_stub",
  },
}));

// Mock jose so JWT signing works with stub PEMs
vi.mock("jose", () => {
  const chainable = {
    setProtectedHeader() { return this; },
    setIssuedAt() { return this; },
    setExpirationTime() { return this; },
    setIssuer() { return this; },
    sign: vi.fn().mockResolvedValue("test-jwt"),
  };
  function SignJWT() { return chainable; }
  return {
    SignJWT,
    importPKCS8: vi.fn().mockResolvedValue("mock-key"),
  };
});

import { server } from "./msw-server";
import { passkitClient } from "../client";
import { PassKitError } from "../types";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("passkitClient.request", () => {
  it("attaches signed JWT in Authorization header (raw, no prefix)", async () => {
    let received: string | null = null;
    server.use(
      http.get("https://api.pub1.passkit.io/programs/p1", ({ request }) => {
        received = request.headers.get("authorization");
        return HttpResponse.json({ id: "p1" });
      }),
    );
    const res = await passkitClient.request<{ id: string }>("GET", "/programs/p1");
    // PassKit REST expects the JWT as the raw Authorization value (no Bearer/PKAuth prefix).
    expect(received).toBe("test-jwt");
    expect(res.id).toBe("p1");
  });

  it("retries on 503 then throws PassKitError UPSTREAM", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.pub1.passkit.io/programs/p2", () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    await expect(passkitClient.request("GET", "/programs/p2")).rejects.toBeInstanceOf(PassKitError);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("does NOT retry on 422 validation", async () => {
    let calls = 0;
    server.use(
      http.post("https://api.pub1.passkit.io/programs", () => {
        calls += 1;
        return HttpResponse.json({ message: "bad shape" }, { status: 422 });
      }),
    );
    await expect(passkitClient.request("POST", "/programs", { body: {} }))
      .rejects.toMatchObject({ code: "VALIDATION", status: 422 });
    expect(calls).toBe(1);
  });

  it("propagates Idempotency-Key header", async () => {
    let received: string | null = null;
    server.use(
      http.post("https://api.pub1.passkit.io/passes", ({ request }) => {
        received = request.headers.get("idempotency-key");
        return HttpResponse.json({ id: "px" });
      }),
    );
    await passkitClient.request("POST", "/passes", { body: {}, idempotencyKey: "abc12345" });
    expect(received).toBe("abc12345");
  });
});
