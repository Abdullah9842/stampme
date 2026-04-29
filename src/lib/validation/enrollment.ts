import { z } from "zod";

export const ksaPhoneSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[\s\-()]/g, ""))
  .transform((raw) => {
    if (/^\+9665\d{8}$/.test(raw)) return raw;
    if (/^9665\d{8}$/.test(raw)) return `+${raw}`;
    if (/^05\d{8}$/.test(raw)) return `+966${raw.slice(1)}`;
    if (/^5\d{8}$/.test(raw)) return `+966${raw}`;
    return raw;
  })
  .refine((v) => /^\+9665\d{8}$/.test(v), {
    message: "رقم جوال سعودي غير صالح. يجب أن يبدأ بـ 5",
  });

export const merchantSlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Invalid slug");

export const enrollPayloadSchema = z.object({
  merchantSlug: merchantSlugSchema,
  phone: ksaPhoneSchema,
  sig: z.string().optional(),
  exp: z.coerce.number().int().positive().optional(),
});
export type EnrollPayload = z.infer<typeof enrollPayloadSchema>;

export const recoverPayloadSchema = z.object({
  merchantSlug: merchantSlugSchema,
  phone: ksaPhoneSchema,
});
export type RecoverPayload = z.infer<typeof recoverPayloadSchema>;
