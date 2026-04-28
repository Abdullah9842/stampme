import { describe, it, expect } from "vitest";
import {
  onboardingStep1Schema,
  onboardingStep2Schema,
  finishOnboardingSchema,
  updateMerchantSchema,
  setStaffPinSchema,
} from "@/lib/validation/merchant";

describe("onboardingStep1Schema", () => {
  it("requires business name 2-80 chars", () => {
    expect(onboardingStep1Schema.safeParse({ name: "", vertical: "CAFE" }).success).toBe(false);
    expect(onboardingStep1Schema.safeParse({ name: "a", vertical: "CAFE" }).success).toBe(false);
    expect(onboardingStep1Schema.safeParse({ name: "ab", vertical: "CAFE" }).success).toBe(true);
    expect(onboardingStep1Schema.safeParse({ name: "x".repeat(81), vertical: "CAFE" }).success).toBe(false);
  });

  it("requires valid vertical enum", () => {
    expect(onboardingStep1Schema.safeParse({ name: "Cafe", vertical: "RESTAURANT" }).success).toBe(false);
    for (const v of ["CAFE", "SALON", "JUICE", "BAKERY", "LAUNDRY", "OTHER"]) {
      expect(onboardingStep1Schema.safeParse({ name: "Cafe", vertical: v }).success).toBe(true);
    }
  });
});

describe("onboardingStep2Schema", () => {
  it("requires hex color #RRGGBB", () => {
    expect(onboardingStep2Schema.safeParse({ logoUrl: "https://x/y.png", brandColor: "#000000" }).success).toBe(true);
    expect(onboardingStep2Schema.safeParse({ logoUrl: "https://x/y.png", brandColor: "red" }).success).toBe(false);
    expect(onboardingStep2Schema.safeParse({ logoUrl: "https://x/y.png", brandColor: "#FFF" }).success).toBe(false);
  });

  it("logoUrl is optional but must be a URL when provided", () => {
    expect(onboardingStep2Schema.safeParse({ brandColor: "#abcdef" }).success).toBe(true);
    expect(onboardingStep2Schema.safeParse({ logoUrl: "not-a-url", brandColor: "#abcdef" }).success).toBe(false);
  });
});

describe("finishOnboardingSchema", () => {
  it("merges all 3 steps", () => {
    const ok = finishOnboardingSchema.safeParse({
      name: "Cafe",
      vertical: "CAFE",
      logoUrl: "https://cdn/x.png",
      brandColor: "#112233",
    });
    expect(ok.success).toBe(true);
  });
});

describe("setStaffPinSchema", () => {
  it("requires 4-digit pin and matching confirm", () => {
    expect(setStaffPinSchema.safeParse({ pin: "1234", confirmPin: "1234" }).success).toBe(true);
    expect(setStaffPinSchema.safeParse({ pin: "1234", confirmPin: "9999" }).success).toBe(false);
    expect(setStaffPinSchema.safeParse({ pin: "abcd", confirmPin: "abcd" }).success).toBe(false);
  });
});

describe("updateMerchantSchema", () => {
  it("all fields optional, but at least one required", () => {
    expect(updateMerchantSchema.safeParse({}).success).toBe(false);
    expect(updateMerchantSchema.safeParse({ name: "New" }).success).toBe(true);
    expect(updateMerchantSchema.safeParse({ brandColor: "#ffffff" }).success).toBe(true);
  });
});
