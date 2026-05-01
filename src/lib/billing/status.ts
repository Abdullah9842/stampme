import type { Subscription } from "@prisma/client";

/** Returns true if the merchant currently has access (active trial or paid). */
export function isSubscriptionActive(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status === "ACTIVE" || sub.status === "TRIALING") return true;
  return false;
}

/** Returns true if the trial has ended (clock-based, not status-based). */
export function isTrialExpired(sub: Subscription | null, now = new Date()): boolean {
  if (!sub) return false;
  if (sub.status !== "TRIALING") return false;
  if (!sub.trialEndsAt) return false;
  return sub.trialEndsAt < now;
}

/** Returns true if the subscription's billing cycle is ending soon (used by cron). */
export function isCycleEndingWithin(
  sub: Subscription,
  hours: number,
  now = new Date(),
): boolean {
  const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return sub.currentPeriodEnd <= cutoff;
}
