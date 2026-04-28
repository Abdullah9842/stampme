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
    .slice(0, 48)
    .replace(/-+$/, "");

  return slug || "merchant";
}

export type SlugExistsCheck = (slug: string) => Promise<boolean>;

/**
 * Finds an unused slug by trying base, base-2..base-50, then base-{nanoid(6)}.
 *
 * NOTE: This is check-then-act. Concurrent callers can both observe "available"
 * and both attempt to insert — the caller MUST handle Prisma P2002 unique
 * constraint violations by retrying. Do not trust the returned slug to still
 * be unique by the time you write it.
 */
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
