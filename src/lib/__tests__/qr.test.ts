import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    ENROLLMENT_HMAC_SECRET: "a".repeat(64),
    NEXT_PUBLIC_APP_URL: "https://stampme.com",
  },
}));

import { generateEnrollmentQrDataUrl, generateQrPosterPdf } from "@/lib/qr";

describe("generateEnrollmentQrDataUrl", () => {
  it("returns a data URL PNG", async () => {
    const out = await generateEnrollmentQrDataUrl("acme-cafe");
    expect(out).toMatch(/^data:image\/png;base64,/);
  });
});

describe("generateQrPosterPdf", () => {
  it("returns a non-empty PDF buffer", async () => {
    const buf = await generateQrPosterPdf({
      merchantName: "Acme Cafe",
      merchantLogoUrl: null,
      brandColor: "#1F6F4A",
      slug: "acme-cafe",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  }, 15_000);
});
