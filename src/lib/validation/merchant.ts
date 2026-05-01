import { z } from "zod";

export const VERTICALS = ["CAFE", "SALON", "JUICE", "BAKERY", "LAUNDRY", "OTHER"] as const;
export const verticalSchema = z.enum(VERTICALS);
export type Vertical = z.infer<typeof verticalSchema>;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Brand color must be a 6-digit hex like #1A2B3C");

export const onboardingStep1Schema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  vertical: verticalSchema,
});

export const onboardingStep2Schema = z.object({
  logoUrl: z.string().url().optional(),
  brandColor: hexColor,
});

// Zod 4: errorMap renamed to error (function returning string | ZodIssue).
// z.literal(true, { errorMap: ... }) is Zod 3 API — not valid in Zod 4.
export const onboardingStep3Schema = z.object({
  acceptedTerms: z.literal(true, {
    // Zod 4 shim: uses `error` key instead of `errorMap`
    error: () => "You must accept the terms",
  }),
});

export const finishOnboardingSchema = onboardingStep1Schema
  .merge(onboardingStep2Schema)
  .extend({
    acceptedTerms: z.boolean().optional(),
  });

export const updateMerchantSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    vertical: verticalSchema.optional(),
    logoUrl: z.string().url().optional(),
    brandColor: hexColor.optional(),
  })
  .refine(
    (d) => Object.values(d).some((v) => v !== undefined),
    { message: "At least one field is required" },
  );

export const setStaffPinSchema = z
  .object({
    pin: z.string().regex(/^\d{6}$/, "PIN must be 6 digits"),
    confirmPin: z.string(),
  })
  .refine((d) => d.pin === d.confirmPin, {
    message: "PINs do not match",
    path: ["confirmPin"],
  });

export type OnboardingStep1 = z.infer<typeof onboardingStep1Schema>;
export type OnboardingStep2 = z.infer<typeof onboardingStep2Schema>;
export type FinishOnboardingInput = z.infer<typeof finishOnboardingSchema>;
export type UpdateMerchantInput = z.infer<typeof updateMerchantSchema>;
export type SetStaffPinInput = z.infer<typeof setStaffPinSchema>;
