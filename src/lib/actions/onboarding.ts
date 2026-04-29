"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "@/lib/i18n/navigation";
import { getLocale } from "next-intl/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
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

  // C1 fix: when no existing merchant row, fetch email/phone from Clerk so we
  // never write ownerEmail:"" — a second concurrent signup would hit the
  // @unique constraint and produce a P2002 500.
  let ownerEmail = "";
  let ownerPhone = "";
  if (!existing) {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    ownerEmail =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      "";
    ownerPhone =
      user.primaryPhoneNumber?.phoneNumber ??
      user.phoneNumbers[0]?.phoneNumber ??
      "";
    if (!ownerEmail) {
      return {
        ok: false,
        error:
          "Profile email not available — try signing out and back in.",
      };
    }
  }

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

  // C2 fix: concurrent signups can race and pick the same slug. Retry up to 3
  // times, recomputing the slug on each P2002 slug collision.
  let merchant;
  let attempts = 0;
  const maxAttempts = 3;
  while (true) {
    attempts++;
    try {
      merchant = await db.merchant.upsert({
        where: { clerkUserId: userId },
        create: {
          clerkUserId: userId,
          name: parsed.data.name,
          vertical: parsed.data.vertical,
          brandColor: parsed.data.brandColor,
          logoUrl: parsed.data.logoUrl ?? null,
          slug,
          ownerEmail,
          ownerPhone,
        },
        update: {
          name: parsed.data.name,
          vertical: parsed.data.vertical,
          brandColor: parsed.data.brandColor,
          logoUrl: parsed.data.logoUrl ?? null,
        },
      });
      break;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        Array.isArray(e.meta?.target) &&
        (e.meta.target as string[]).includes("slug") &&
        attempts < maxAttempts
      ) {
        // Slug got taken by a concurrent signup — recompute with a fresh suffix
        const base = generateMerchantSlug(parsed.data.name);
        slug = await ensureUniqueSlug(base, async (candidate) => {
          const found = await db.merchant.findFirst({
            where: { slug: candidate },
            select: { id: true },
          });
          return Boolean(found);
        });
        continue;
      }
      throw e;
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { merchantId: merchant.id, slug: merchant.slug } };
}

/**
 * Calls finishOnboarding and, on success, redirects to /cards/new (throws via Next.js redirect).
 * On failure, returns the ActionResult error envelope so the form can render field errors.
 */
export async function finishOnboardingAndRedirect(
  input: FinishOnboardingInput,
): Promise<ActionResult<{ merchantId: string; slug: string }>> {
  const result = await finishOnboarding(input);
  if (!result.ok) return result;
  const locale = await getLocale();
  redirect({ href: "/cards/new", locale });
  // unreachable — redirect throws
  return result;
}
