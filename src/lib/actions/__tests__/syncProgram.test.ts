import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, update, createProgram, updateProgramTemplate, authMock } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  createProgram: vi.fn(),
  updateProgramTemplate: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { loyaltyProgram: { findUnique, update } },
}));
vi.mock("@/lib/passkit/programs", () => ({ createProgram, updateProgramTemplate }));
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { syncProgram } from "../syncProgram";

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  createProgram.mockReset();
  updateProgramTemplate.mockReset();
  authMock.mockReset();
  authMock.mockResolvedValue({ userId: "user_owner" });
});

describe("syncProgram", () => {
  const baseProgram = {
    id: "lp_1",
    merchantId: "m_1",
    passKitProgramId: null,
    name: "Loyalty",
    stampsRequired: 10,
    rewardLabel: "Free coffee",
    merchant: {
      id: "m_1",
      clerkUserId: "user_owner",
      name: "Brew Bros",
      brandColor: "#0F4C3A",
      logoUrl: "https://r2/x.png",
    },
  };

  it("creates program when passKitProgramId is null", async () => {
    findUnique.mockResolvedValue(baseProgram);
    createProgram.mockResolvedValue({ passKitProgramId: "prg_x", passKitTemplateId: "tpl_x" });
    update.mockResolvedValue({});
    updateProgramTemplate.mockResolvedValue(undefined);

    const out = await syncProgram({ loyaltyProgramId: "lp_1" });
    expect(out.passKitProgramId).toBe("prg_x");
    expect(out.created).toBe(true);
    expect(createProgram).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: "lp_1" },
      data: { passKitProgramId: "prg_x" },
    });
  });

  it("idempotent: when programId exists, only updates template", async () => {
    findUnique.mockResolvedValue({ ...baseProgram, passKitProgramId: "prg_x" });
    updateProgramTemplate.mockResolvedValue(undefined);
    const out = await syncProgram({ loyaltyProgramId: "lp_1" });
    expect(out.created).toBe(false);
    expect(createProgram).not.toHaveBeenCalled();
    expect(updateProgramTemplate).toHaveBeenCalledOnce();
  });

  it("missing logo throws", async () => {
    findUnique.mockResolvedValue({ ...baseProgram, merchant: { ...baseProgram.merchant, logoUrl: null } });
    await expect(syncProgram({ loyaltyProgramId: "lp_1" })).rejects.toThrow(/logo/i);
  });

  it("rejects non-owner sync", async () => {
    findUnique.mockResolvedValue(baseProgram);
    authMock.mockResolvedValueOnce({ userId: "user_other" });
    await expect(syncProgram({ loyaltyProgramId: "lp_1" })).rejects.toThrow(/auth/i);
  });
});
