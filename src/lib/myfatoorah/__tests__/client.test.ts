import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    MYFATOORAH_API_KEY: "SK_TEST_stub",
    MYFATOORAH_BASE_URL: "https://apitest.myfatoorah.com",
    MYFATOORAH_WEBHOOK_SECRET: "stub_secret",
  },
}));

import { myfatoorahClient } from "@/lib/myfatoorah/client";
import { MyFatoorahError } from "@/lib/myfatoorah/types";

const fetchMock = vi.fn();
beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  fetchMock.mockReset();
});

describe("myfatoorahClient.request", () => {
  it("attaches Bearer auth header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ IsSuccess: true, Data: { ok: 1 } }), {
        status: 200,
      }),
    );
    await myfatoorahClient.request("GET", "/v2/something");
    const call = fetchMock.mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toMatch(/^Bearer SK_TEST_stub$/);
  });

  it("unwraps IsSuccess: true responses to Data", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ IsSuccess: true, Data: { invoiceId: 42 } }),
        { status: 200 },
      ),
    );
    const res = await myfatoorahClient.request<{ invoiceId: number }>(
      "POST",
      "/v2/InitiateSession",
    );
    expect(res.invoiceId).toBe(42);
  });

  it("throws VALIDATION when IsSuccess: false even on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          IsSuccess: false,
          Message: "Customer email is invalid",
        }),
        { status: 200 },
      ),
    );
    await expect(
      myfatoorahClient.request("POST", "/v2/ExecutePayment", { body: {} }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("retries on 503 then throws UPSTREAM", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(
      myfatoorahClient.request("GET", "/v2/whatever"),
    ).rejects.toBeInstanceOf(MyFatoorahError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(
      myfatoorahClient.request("GET", "/v2/whatever"),
    ).rejects.toMatchObject({ code: "AUTH", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
