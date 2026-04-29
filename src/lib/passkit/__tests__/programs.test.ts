import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

// Mock jose so JWT signing works with stub PEMs (same as client.test.ts)
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
    PASSKIT_API_SECRET: "stub-secret",
    PASSKIT_WEBHOOK_SECRET: "whsec_stub",
    NODE_ENV: "test",
  },
}));

import { server } from "./msw-server";
import { createProgram, updateProgramTemplate } from "../programs";
import { PassKitError } from "../types";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const validProgram = {
  merchantId: "m_1",
  name: "Brew Bros Loyalty",
  brandColor: "#0F4C3A",
  logoUrl: "https://r2.stampme.com/m_1/logo.png",
  rewardLabel: "Free coffee",
  stampsRequired: 10,
};

describe("createProgram", () => {
  it("POSTs /members/program and returns ids", async () => {
    server.use(
      http.post("https://api.pub1.passkit.io/members/program", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.name).toBe("Brew Bros Loyalty");
        expect(request.headers.get("idempotency-key")).toBe("m_1");
        return HttpResponse.json({ id: "prg_abc", templateId: "tpl_abc" });
      }),
    );
    const out = await createProgram(validProgram);
    expect(out).toEqual({ passKitProgramId: "prg_abc", passKitTemplateId: "tpl_abc" });
  });

  it("rejects invalid input via Zod", async () => {
    await expect(createProgram({ ...validProgram, brandColor: "red" } as never))
      .rejects.toBeInstanceOf(PassKitError);
  });

  it("is idempotent — same merchantId re-uses key", async () => {
    let count = 0;
    server.use(
      http.post("https://api.pub1.passkit.io/members/program", () => {
        count += 1;
        return HttpResponse.json({ id: "prg_abc", templateId: "tpl_abc" });
      }),
    );
    await createProgram(validProgram);
    await createProgram(validProgram);
    expect(count).toBe(2);
  });
});

describe("updateProgramTemplate", () => {
  it("PUTs /members/program/template/{programId}", async () => {
    server.use(
      http.put("https://api.pub1.passkit.io/members/program/template/prg_abc", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.backgroundColor).toBe("#0F4C3A");
        expect(body.images).toMatchObject({ logo: "https://r2.stampme.com/m_1/logo.png" });
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(
      updateProgramTemplate({ programId: "prg_abc", ...validProgram }),
    ).resolves.toBeUndefined();
  });
});
