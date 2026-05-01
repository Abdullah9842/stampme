import type { Plan } from "@prisma/client";

export type PlanConfig = {
  monthlyPriceSar: number; // SAR (whole number)
  passQuotaPerMonth: number;
  displayNameAr: string;
  displayNameEn: string;
};

export const PLAN_CONFIG: Record<Plan, PlanConfig> = {
  STARTER: {
    monthlyPriceSar: 99,
    passQuotaPerMonth: 300,
    displayNameAr: "المبتدئ",
    displayNameEn: "Starter",
  },
  GROWTH: {
    monthlyPriceSar: 249,
    passQuotaPerMonth: 1000,
    displayNameAr: "النمو",
    displayNameEn: "Growth",
  },
  PRO: {
    monthlyPriceSar: 499,
    passQuotaPerMonth: 5000,
    displayNameAr: "الاحترافي",
    displayNameEn: "Pro",
  },
};

export const TRIAL_DAYS = 14;
export const VAT_RATE = 0.15; // KSA VAT 15%

/**
 * Total amount including VAT (15%).
 * Returns SAR as a number (e.g. 99 SAR base → 113.85 SAR with VAT).
 * Round to 2 decimals.
 */
export function priceWithVat(plan: Plan): number {
  const base = PLAN_CONFIG[plan].monthlyPriceSar;
  return Math.round(base * (1 + VAT_RATE) * 100) / 100;
}
