import { z } from "zod";

// -------- Phone (KSA) --------
export const ksaPhoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?966|0)?5\d{8}$/u, "رقم جوّال سعودي غير صحيح");

// -------- Email --------
export const emailSchema = z.string().trim().toLowerCase().email();

// -------- Brand color (HEX) --------
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u, "Invalid hex color");

// -------- Merchant onboarding (Plan 2 canonical) --------
export const merchantOnboardingSchema = z.object({
  name: z.string().trim().min(2).max(80),
  ownerEmail: emailSchema,
  ownerPhone: ksaPhoneSchema,
  vertical: z.enum(["CAFE", "SALON", "JUICE", "BAKERY", "LAUNDRY", "OTHER"]),
  brandColor: hexColorSchema.default("#0A7C36"),
});
export type MerchantOnboardingInput = z.infer<typeof merchantOnboardingSchema>;

// -------- Clerk webhook (subset) --------
export const clerkUserCreatedSchema = z.object({
  type: z.literal("user.created"),
  data: z.object({
    id: z.string(),
    email_addresses: z
      .array(
        z.object({
          email_address: z.string().email(),
          id: z.string(),
        }),
      )
      .min(1),
    primary_email_address_id: z.string().nullable(),
    phone_numbers: z
      .array(
        z.object({
          phone_number: z.string(),
          id: z.string(),
        }),
      )
      .default([]),
    primary_phone_number_id: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    unsafe_metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ClerkUserCreated = z.infer<typeof clerkUserCreatedSchema>;
