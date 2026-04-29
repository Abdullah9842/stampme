import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, upsert, findFirst } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    merchant: { findUnique, upsert, findFirst },
  },
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_42"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("ar") }));

import { finishOnboarding } from "@/lib/actions/onboarding";

describe("finishOnboarding", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    findFirst.mockReset();
    findFirst.mockResolvedValue(null); // slug never taken by default
  });

  it("returns validation error on bad input", async () => {
    const result = await finishOnboarding({
      name: "",
      vertical: "CAFE",
      brandColor: "#000000",
      acceptedTerms: true,
    } as any);
    expect(result.ok).toBe(false);
  });

  it("returns error if acceptedTerms is missing/false (I2 hardening)", async () => {
    const result = await finishOnboarding({
      name: "My Cafe",
      vertical: "CAFE",
      brandColor: "#112233",
      // acceptedTerms omitted on purpose
    } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/terms/i);
  });

  it("creates merchant with generated slug", async () => {
    findUnique.mockResolvedValueOnce(null); // no existing merchant
    upsert.mockResolvedValue({ id: "m_1", slug: "my-cafe" });
    const result = await finishOnboarding({
      name: "My Cafe",
      vertical: "CAFE",
      brandColor: "#112233",
      logoUrl: "https://cdn/x.png",
      acceptedTerms: true,
    });
    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clerkUserId: "user_42" },
        create: expect.objectContaining({
          name: "My Cafe",
          vertical: "CAFE",
          slug: "my-cafe",
          brandColor: "#112233",
          logoUrl: "https://cdn/x.png",
          clerkUserId: "user_42",
        }),
      }),
    );
  });

  it("appends suffix when slug is taken", async () => {
    findUnique.mockResolvedValueOnce(null); // no existing merchant
    findFirst.mockResolvedValueOnce({ id: "other" }); // 'my-cafe' taken
    findFirst.mockResolvedValueOnce(null); // 'my-cafe-2' free
    upsert.mockResolvedValue({ id: "m_2", slug: "my-cafe-2" });
    await finishOnboarding({
      name: "My Cafe",
      vertical: "CAFE",
      brandColor: "#112233",
      acceptedTerms: true,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ slug: "my-cafe-2" }),
      }),
    );
  });

  it("preserves slug on update if merchant already exists", async () => {
    findUnique.mockResolvedValueOnce({ id: "m_existing", slug: "existing-slug" });
    upsert.mockResolvedValue({ id: "m_existing", slug: "existing-slug" });
    await finishOnboarding({
      name: "Renamed Cafe",
      vertical: "CAFE",
      brandColor: "#aabbcc",
      acceptedTerms: true,
    });
    const callArg = upsert.mock.calls[0][0];
    // slug should NOT be in the update payload
    expect(callArg.update).not.toHaveProperty("slug");
    expect(callArg.update.name).toBe("Renamed Cafe");
  });
});
