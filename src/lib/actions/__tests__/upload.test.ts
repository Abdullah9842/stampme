import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { input };
  }),
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_123"),
}));

vi.mock("@/lib/r2", () => ({
  getR2: () => ({ send: sendMock }),
  R2_BUCKET: "test-bucket",
  R2_PUBLIC_URL: "https://cdn.test",
}));

import { uploadLogo } from "@/lib/actions/upload";

describe("uploadLogo", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  function makeFormData(file: File, merchantId = "m_abc") {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("merchantId", merchantId);
    return fd;
  }

  it("rejects non-image mime types", async () => {
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/file type/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects files larger than 2MB", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(big));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/2MB/);
  });

  it("uploads PNG and returns CDN URL", async () => {
    const file = new File([new Uint8Array(1024)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toMatch(/^https:\/\/cdn\.test\/merchants\/m_abc\/logo\.png$/);
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
    expect(result.error).toMatch(/upload failed/i);
  });
});
