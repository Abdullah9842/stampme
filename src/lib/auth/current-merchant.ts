import "server-only";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getLocale } from "next-intl/server";
import { redirect } from "@/lib/i18n/navigation";

export async function getClerkUserIdOrThrow(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return userId;
}

/**
 * Returns the Merchant for the current Clerk user, or null if onboarding not done yet.
 */
export async function getCurrentMerchant() {
  const userId = await getClerkUserIdOrThrow();
  return db.merchant.findUnique({ where: { clerkUserId: userId } });
}

/**
 * Loads the merchant or redirects to /onboarding when missing.
 * Use this in protected merchant pages (NOT during onboarding itself).
 */
export async function requireMerchant() {
  const m = await getCurrentMerchant();
  if (!m) {
    const locale = await getLocale();
    redirect({ href: "/onboarding", locale });
  }
  return m;
}
