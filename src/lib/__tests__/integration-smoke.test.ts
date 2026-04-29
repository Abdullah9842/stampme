import { describe, it, expect } from "vitest";

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
