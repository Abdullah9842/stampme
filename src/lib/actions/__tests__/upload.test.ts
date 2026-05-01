import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const getCurrentMerchantMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function () { return { send: sendMock }; }),
  PutObjectCommand: vi.fn().mockImplementation(function (input) { return { input }; }),
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  getCurrentMerchant: getCurrentMerchantMock,
}));

vi.mock("@/lib/r2", () => ({
  getR2: () => ({ send: sendMock }),
  R2_BUCKET: "test-bucket",
  R2_PUBLIC_URL: "https://cdn.test",
}));

const authedLimiterMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ratelimit", () => ({
  authedMerchantLimiter: { limit: authedLimiterMock },
}));

import { uploadLogo } from "@/lib/actions/upload";

describe("uploadLogo", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    getCurrentMerchantMock.mockReset();
    getCurrentMerchantMock.mockResolvedValue({ id: "m_abc", clerkUserId: "user_123" });
    authedLimiterMock.mockReset();
    authedLimiterMock.mockResolvedValue({ success: true });
  });

  function makeFormData(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    return fd;
  }

  it("returns ok=false when authed limiter trips", async () => {
    authedLimiterMock.mockResolvedValueOnce({ success: false, reset: Date.now() + 1000 });
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too many/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 'Not authenticated' if getCurrentMerchant throws", async () => {
    getCurrentMerchantMock.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not authenticated/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 'Onboarding required' if no Merchant row yet", async () => {
    getCurrentMerchantMock.mockResolvedValueOnce(null);
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/onboarding/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 'No file provided' when formData has no file", async () => {
    const fd = new FormData();
    const result = await uploadLogo(fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no file/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects non-image mime types", async () => {
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/file type/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects files larger than 2MB", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(big));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2MB/);
  });

  it("uploads PNG and returns CDN URL", async () => {
    const file = new File([new Uint8Array(1024)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://cdn.test/merchants/m_abc/logo.png");
    }
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("preserves SVG extension", async () => {
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toMatch(/\.svg$/);
  });

  it("returns ok=false if S3 throws", async () => {
    sendMock.mockRejectedValueOnce(new Error("R2 down"));
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/upload failed/i);
  });
});
