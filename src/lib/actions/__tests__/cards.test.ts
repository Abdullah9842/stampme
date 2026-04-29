import { describe, it, expect, vi, beforeEach } from "vitest";

const { programCreate, programUpdate, programFindFirst, programFindMany, requireMerchant } = vi.hoisted(() => ({
  programCreate: vi.fn(),
  programUpdate: vi.fn(),
  programFindFirst: vi.fn(),
  programFindMany: vi.fn(),
  requireMerchant: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    loyaltyProgram: {
      create: programCreate,
      update: programUpdate,
      findFirst: programFindFirst,
      findMany: programFindMany,
    },
  },
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  requireMerchant,
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_x"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createCard, updateCard, listCards } from "@/lib/actions/cards";

describe("createCard", () => {
  beforeEach(() => {
    programCreate.mockReset();
    requireMerchant.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("rejects invalid input", async () => {
    const r = await createCard({ programName: "", stampsRequired: 10, rewardLabel: "x" });
    expect(r.ok).toBe(false);
  });

  it("creates a program with passKitProgramId=null", async () => {
    programCreate.mockResolvedValue({ id: "p_1" });
    const r = await createCard({
      programName: "Loyalty",
      stampsRequired: 10,
      rewardLabel: "Free",
    });
    expect(r.ok).toBe(true);
    expect(programCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "m_1",
        name: "Loyalty",
        stampsRequired: 10,
        rewardLabel: "Free",
        passKitProgramId: null,
      }),
    });
  });
});

describe("updateCard", () => {
  beforeEach(() => {
    programUpdate.mockReset();
    programFindFirst.mockReset();
    requireMerchant.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("404s when program belongs to another merchant", async () => {
    programFindFirst.mockResolvedValue(null);
    const r = await updateCard({ id: "p_other", programName: "Hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not found/i);
  });

  it("updates only provided fields", async () => {
    programFindFirst.mockResolvedValue({ id: "p_1", merchantId: "m_1" });
    programUpdate.mockResolvedValue({ id: "p_1" });
    const r = await updateCard({ id: "p_1", stampsRequired: 12 });
    expect(r.ok).toBe(true);
    expect(programUpdate).toHaveBeenCalledWith({
      where: { id: "p_1" },
      data: { stampsRequired: 12 },
    });
  });
});

describe("listCards", () => {
  beforeEach(() => {
    programFindMany.mockReset();
    requireMerchant.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("returns merchant's cards", async () => {
    programFindMany.mockResolvedValue([{ id: "p_1", name: "Test", stampsRequired: 10, rewardLabel: "Free", passKitProgramId: null, createdAt: new Date() }]);
    const r = await listCards();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toHaveLength(1);
    expect(programFindMany).toHaveBeenCalledWith({
      where: { merchantId: "m_1" },
      orderBy: { createdAt: "desc" },
    });
  });
});
