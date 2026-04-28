import slugify from "slugify";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

export function generateMerchantSlug(input: string): string {
  if (!input?.trim()) return "merchant";

  const slug = slugify(input, {
    lower: true,
    strict: true,
    locale: "ar",
    trim: true,
  })
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return slug || "merchant";
}

export type SlugExistsCheck = (slug: string) => Promise<boolean>;

export async function ensureUniqueSlug(
  base: string,
  exists: SlugExistsCheck,
): Promise<string> {
  if (!(await exists(base))) return base;

  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }

  return `${base}-${nanoid()}`;
}
