import { describe, it, expect, vi } from "vitest";

// Stub modules that next-intl/Clerk pull in transitively but vitest can't resolve.
// We're checking export presence, not behavior — these stubs just unblock import resolution.
// Mock the i18n navigation wrapper directly to bypass next-intl's ESM resolution
// of next/navigation (which fails in vitest 4 with next-intl 4).
vi.mock("@/lib/i18n/navigation", () => ({
  redirect: vi.fn(),
  Link: vi.fn(),
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  getPathname: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("en") }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "smoke-test-user" }),
  clerkClient: vi.fn().mockResolvedValue({ users: { getUser: vi.fn() } }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    merchant: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    loyaltyProgram: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    staffPin: { deleteMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe("plan-2 surface area", () => {
  it("server actions are exported", async () => {
    const onboarding = await import("@/lib/actions/onboarding");
    const cards = await import("@/lib/actions/cards");
    const settings = await import("@/lib/actions/settings");
    const upload = await import("@/lib/actions/upload");

    expect(typeof onboarding.finishOnboarding).toBe("function");
    expect(typeof cards.createCard).toBe("function");
    expect(typeof cards.updateCard).toBe("function");
    expect(typeof cards.listCards).toBe("function");
    expect(typeof settings.updateMerchantProfile).toBe("function");
    expect(typeof settings.setStaffPin).toBe("function");
    expect(typeof upload.uploadLogo).toBe("function");
  });

  it("validation schemas export expected shapes", async () => {
    const m = await import("@/lib/validation/merchant");
    const c = await import("@/lib/validation/card");
    expect(m.VERTICALS).toContain("CAFE");
    expect(c.createCardSchema.shape.programName).toBeDefined();
  });
});
