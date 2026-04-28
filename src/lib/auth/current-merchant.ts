import "server-only";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

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
 *
 * TODO(task-18): The marketing site uses next-intl locale prefixes (/ar, /en).
 * Auth-protected pages live under /[locale]/onboarding. The non-prefixed redirect
 * here relies on next-intl middleware rewriting it to the active locale on response.
 * If that assumption is wrong, the integration test in Task 18 will catch it.
 */
export async function requireMerchant() {
  const m = await getCurrentMerchant();
  if (!m) redirect("/onboarding");
  return m;
}
