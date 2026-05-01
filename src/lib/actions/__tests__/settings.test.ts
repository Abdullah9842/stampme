import { describe, it, expect, vi, beforeEach } from "vitest";

const { merchantUpdate, staffPinDeleteMany, staffPinCreate, requireMerchant } = vi.hoisted(() => ({
  merchantUpdate: vi.fn(),
  staffPinDeleteMany: vi.fn(),
  staffPinCreate: vi.fn(),
  requireMerchant: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    merchant: { update: merchantUpdate },
    staffPin: { deleteMany: staffPinDeleteMany, create: staffPinCreate },
    $transaction: vi.fn(async (cb) =>
      cb({
        staffPin: { deleteMany: staffPinDeleteMany, create: staffPinCreate },
      }),
    ),
  },
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  requireMerchant,
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_x"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/pin", () => ({
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
}));

import { updateMerchantProfile, setStaffPin } from "@/lib/actions/settings";

describe("updateMerchantProfile", () => {
  beforeEach(() => {
    merchantUpdate.mockReset();
    requireMerchant.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("rejects empty payload", async () => {
    const r = await updateMerchantProfile({});
    expect(r.ok).toBe(false);
  });

  it("updates only provided fields", async () => {
    merchantUpdate.mockResolvedValue({ id: "m_1" });
    const r = await updateMerchantProfile({ brandColor: "#ff0000" });
    expect(r.ok).toBe(true);
    expect(merchantUpdate).toHaveBeenCalledWith({
      where: { id: "m_1" },
      data: { brandColor: "#ff0000" },
    });
  });
});

describe("setStaffPin", () => {
  beforeEach(() => {
    staffPinDeleteMany.mockReset();
    staffPinCreate.mockReset();
    requireMerchant.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("rejects mismatched confirm", async () => {
    const r = await setStaffPin({ pin: "123456", confirmPin: "000000" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-digit pin", async () => {
    const r = await setStaffPin({ pin: "abcdef", confirmPin: "abcdef" });
    expect(r.ok).toBe(false);
  });

  it("rejects 4-digit pin (must be 6)", async () => {
    const r = await setStaffPin({ pin: "1234", confirmPin: "1234" });
    expect(r.ok).toBe(false);
  });

  it("replaces existing pin atomically", async () => {
    staffPinCreate.mockResolvedValue({ id: "sp_1" });
    const r = await setStaffPin({ pin: "123456", confirmPin: "123456" });
    expect(r.ok).toBe(true);
    expect(staffPinDeleteMany).toHaveBeenCalledWith({ where: { merchantId: "m_1" } });
    expect(staffPinCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "m_1",
        pinHash: "hashed:123456",
        label: "default",
      }),
    });
  });
});
