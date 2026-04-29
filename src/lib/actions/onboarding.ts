"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "@/lib/i18n/navigation";
import { getLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { getClerkUserIdOrThrow } from "@/lib/auth/current-merchant";
import {
  finishOnboardingSchema,
  type FinishOnboardingInput,
} from "@/lib/validation/merchant";
import { generateMerchantSlug, ensureUniqueSlug } from "@/lib/slug";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function finishOnboarding(
  input: FinishOnboardingInput,
): Promise<ActionResult<{ merchantId: string; slug: string }>> {
  const userId = await getClerkUserIdOrThrow();

  const parsed = finishOnboardingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid onboarding payload",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // I2 hardening: finishOnboardingSchema makes acceptedTerms optional, but the
  // server action must enforce it. The schema is permissive so multi-step UIs
  // can validate per-step; the final commit must verify the gate.
  if (parsed.data.acceptedTerms !== true) {
    return { ok: false, error: "You must accept the terms" };
  }

  const existing = await db.merchant.findUnique({
    where: { clerkUserId: userId },
  });

  let slug = existing?.slug;
  if (!slug) {
    const base = generateMerchantSlug(parsed.data.name);
    slug = await ensureUniqueSlug(base, async (candidate) => {
      const found = await db.merchant.findFirst({
        where: { slug: candidate },
        select: { id: true },
      });
      return Boolean(found);
    });
  }

  const merchant = await db.merchant.upsert({
    where: { clerkUserId: userId },
    create: {
      clerkUserId: userId,
      name: parsed.data.name,
      vertical: parsed.data.vertical,
      brandColor: parsed.data.brandColor,
      logoUrl: parsed.data.logoUrl ?? null,
      slug,
      ownerEmail: "", // populated by Clerk webhook on user.created; left empty here as a fallback
      ownerPhone: "",
    },
    update: {
      name: parsed.data.name,
      vertical: parsed.data.vertical,
      brandColor: parsed.data.brandColor,
      logoUrl: parsed.data.logoUrl ?? null,
    },
  });

  revalidatePath("/", "layout");
  return { ok: true, data: { merchantId: merchant.id, slug: merchant.slug } };
}

export async function finishOnboardingAndRedirect(
  input: FinishOnboardingInput,
): Promise<never | ActionResult> {
  const result = await finishOnboarding(input);
  if (!result.ok) return result;
  const locale = await getLocale();
  redirect({ href: "/cards/new", locale });
}
