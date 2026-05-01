"use server";

import "server-only";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireMerchant } from "@/lib/auth/current-merchant";
import { authedMerchantLimiter } from "@/lib/ratelimit";
import { myfatoorahClient } from "@/lib/myfatoorah/client";
import { MyFatoorahError } from "@/lib/myfatoorah/types";
import { priceWithVat, TRIAL_DAYS } from "@/lib/billing/plans";
import type { Plan } from "@prisma/client";

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Idempotent: creates a 14-day TRIALING Subscription if the merchant has none.
 * Called from: Clerk webhook on user.created, finishOnboarding fallback,
 * and any "you don't have a subscription" UI guard.
 */
export async function startTrial(
  merchantId: string,
): Promise<Result<{ subscriptionId: string }>> {
  const existing = await db.subscription.findUnique({ where: { merchantId } });
  if (existing) {
    return { ok: true, data: { subscriptionId: existing.id } };
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const sub = await db.subscription.create({
    data: {
      merchantId,
      plan: "STARTER",
      status: "TRIALING",
      provider: "MYFATOORAH",
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
    },
  });
  return { ok: true, data: { subscriptionId: sub.id } };
}

const createCheckoutInput = z.object({
  plan: z.enum(["STARTER", "GROWTH", "PRO"]),
});

/**
 * Creates a MyFatoorah hosted-checkout payment URL for the chosen plan.
 * Returns the URL to redirect the merchant to. After payment, MyFatoorah
 * redirects back to /api/billing/callback (Phase D).
 */
export async function createCheckoutSession(
  input: unknown,
): Promise<Result<{ paymentUrl: string; invoiceId: number }>> {
  const merchant = await requireMerchant();
  if (!merchant) return { ok: false, error: "Merchant not found" };

  const rl = await authedMerchantLimiter.limit(merchant.id);
  if (!rl.success) return { ok: false, error: "Too many requests, slow down" };

  const parsed = createCheckoutInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid plan" };
  const { plan } = parsed.data;

  if (!merchant.ownerEmail) {
    return {
      ok: false,
      error: "Merchant email missing — please update your profile first",
    };
  }

  const amountSar = priceWithVat(plan);
  const callbackUrl = `${env.NEXT_PUBLIC_APP_URL}/api/billing/callback?merchantId=${merchant.id}&plan=${plan}`;
  const errorUrl = `${env.NEXT_PUBLIC_APP_URL}/ar/settings?billing=error`;

  try {
    const data = await myfatoorahClient.request<{
      InvoiceId: number;
      InvoiceURL: string;
      CustomerReference?: string;
    }>("POST", "/v2/SendPayment", {
      body: {
        NotificationOption: "LNK", // returns InvoiceURL (link)
        InvoiceValue: amountSar,
        CustomerName: merchant.name,
        CustomerEmail: merchant.ownerEmail,
        CustomerMobile: merchant.ownerPhone || undefined,
        DisplayCurrencyIso: "SAR",
        CallBackUrl: callbackUrl,
        ErrorUrl: errorUrl,
        Language: "AR",
        CustomerReference: merchant.id,
        UserDefinedField: plan,
      },
    });

    return {
      ok: true,
      data: { paymentUrl: data.InvoiceURL, invoiceId: data.InvoiceId },
    };
  } catch (e) {
    Sentry.captureException(e, {
      tags: { action: "createCheckoutSession", merchantId: merchant.id },
    });
    if (e instanceof MyFatoorahError) {
      return { ok: false, error: `Payment provider error: ${e.message}` };
    }
    return { ok: false, error: "Could not create checkout session" };
  }
}

/**
 * Called from /api/billing/callback after MyFatoorah redirects back.
 * Fetches the payment status, marks Charge SUCCEEDED, activates Subscription,
 * saves PaymentMethod (RecurringId for future renewals).
 */
export async function applyPaymentResult(args: {
  merchantId: string;
  plan: Plan;
  invoiceId: number;
}): Promise<Result<{ status: "ACTIVE" | "FAILED" }>> {
  const { merchantId, plan, invoiceId } = args;

  let payment: {
    InvoiceStatus: string;
    InvoiceTransactions?: Array<{
      TransactionStatus: string;
      PaymentId: string;
      RecurringId?: string;
      CardNumber?: string;
      CardBrand?: string;
      ExpiryMonth?: string;
      ExpiryYear?: string;
      HolderName?: string;
    }>;
  };
  try {
    payment = await myfatoorahClient.request("POST", "/v2/getPaymentStatus", {
      body: { Key: invoiceId, KeyType: "InvoiceId" },
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { action: "applyPaymentResult", merchantId, invoiceId },
    });
    return { ok: false, error: "Could not verify payment status" };
  }

  if (payment.InvoiceStatus !== "Paid") {
    // Mark as failed
    const sub = await db.subscription.findUnique({ where: { merchantId } });
    if (sub) {
      await db.charge.create({
        data: {
          subscriptionId: sub.id,
          amountSar: Math.round(priceWithVat(plan) * 100),
          status: "FAILED",
          provider: "MYFATOORAH",
          providerInvoiceId: String(invoiceId),
          failureReason: `InvoiceStatus=${payment.InvoiceStatus}`,
        },
      });
    }
    return { ok: true, data: { status: "FAILED" } };
  }

  // Find the successful transaction
  // NOTE: MyFatoorah API uses "Succss" (documented typo — one 's') as the
  // TransactionStatus value for successful transactions. We also handle "Success"
  // defensively in case they fix the typo in a future API version.
  const txn = payment.InvoiceTransactions?.find(
    (t) => t.TransactionStatus === "Succss" || t.TransactionStatus === "Success",
  );
  if (!txn) {
    return { ok: false, error: "No successful transaction in invoice" };
  }

  const now = new Date();
  const oneMonthLater = new Date(now);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

  // Upsert Subscription → ACTIVE on this plan
  const sub = await db.subscription.upsert({
    where: { merchantId },
    create: {
      merchantId,
      plan,
      status: "ACTIVE",
      provider: "MYFATOORAH",
      providerRef: String(invoiceId),
      currentPeriodEnd: oneMonthLater,
      trialEndsAt: null,
    },
    update: {
      plan,
      status: "ACTIVE",
      provider: "MYFATOORAH",
      providerRef: String(invoiceId),
      currentPeriodEnd: oneMonthLater,
      trialEndsAt: null,
    },
  });

  // Log the successful charge
  await db.charge.create({
    data: {
      subscriptionId: sub.id,
      amountSar: Math.round(priceWithVat(plan) * 100),
      status: "SUCCEEDED",
      provider: "MYFATOORAH",
      providerInvoiceId: String(invoiceId),
      providerPaymentId: txn.PaymentId,
      succeededAt: now,
    },
  });

  // Save PaymentMethod if RecurringId returned (enables auto-renewal)
  if (txn.RecurringId && txn.CardNumber) {
    const last4 = txn.CardNumber.replace(/\D/g, "").slice(-4);
    await db.paymentMethod.upsert({
      where: { merchantId },
      create: {
        merchantId,
        provider: "MYFATOORAH",
        recurringId: txn.RecurringId,
        last4,
        brand: txn.CardBrand ?? "UNKNOWN",
        expMonth: parseInt(txn.ExpiryMonth ?? "0", 10) || 0,
        expYear: parseInt(txn.ExpiryYear ?? "0", 10) || 0,
        holderName: txn.HolderName ?? null,
      },
      update: {
        recurringId: txn.RecurringId,
        last4,
        brand: txn.CardBrand ?? "UNKNOWN",
        expMonth: parseInt(txn.ExpiryMonth ?? "0", 10) || 0,
        expYear: parseInt(txn.ExpiryYear ?? "0", 10) || 0,
        holderName: txn.HolderName ?? null,
      },
    });
  }

  revalidatePath("/ar/settings");
  revalidatePath("/en/settings");
  return { ok: true, data: { status: "ACTIVE" } };
}

/**
 * Cancels at end of current period. Customer keeps access until currentPeriodEnd,
 * then cron will not renew (status flips to CANCELED).
 *
 * MVP: we flip status to CANCELED immediately, which revokes access right away
 * (isSubscriptionActive only allows ACTIVE/TRIALING). This is the safe default.
 */
export async function cancelSubscription(): Promise<Result> {
  const merchant = await requireMerchant();
  if (!merchant) return { ok: false, error: "Merchant not found" };

  const rl = await authedMerchantLimiter.limit(merchant.id);
  if (!rl.success) return { ok: false, error: "Too many requests, slow down" };

  const sub = await db.subscription.findUnique({ where: { merchantId: merchant.id } });
  if (!sub) return { ok: false, error: "No active subscription" };

  await db.subscription.update({
    where: { merchantId: merchant.id },
    data: { status: "CANCELED" },
  });

  // Cancel saved RecurringId on MyFatoorah side so they don't keep the token
  const pm = await db.paymentMethod.findUnique({ where: { merchantId: merchant.id } });
  if (pm) {
    try {
      await myfatoorahClient.request("POST", "/v2/CancelRecurringPayment", {
        body: { RecurringId: pm.recurringId },
      });
    } catch (e) {
      // Don't block cancellation on provider error — log and continue
      Sentry.captureException(e, {
        tags: {
          action: "cancelSubscription:cancelRecurring",
          merchantId: merchant.id,
        },
      });
    }
  }

  revalidatePath("/ar/settings");
  revalidatePath("/en/settings");
  return { ok: true };
}

/**
 * Internal — called by cron only. Charges saved RecurringId for renewal.
 * Guarded by BILLING_AUTO_CHARGE_ENABLED env flag (default false in dev).
 */
export async function chargeRecurring(
  subscriptionId: string,
): Promise<Result<{ chargeId: string; status: "SUCCEEDED" | "FAILED" }>> {
  if (!env.BILLING_AUTO_CHARGE_ENABLED) {
    return {
      ok: false,
      error: "Auto-charge disabled (BILLING_AUTO_CHARGE_ENABLED=false)",
    };
  }

  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: { merchant: true },
  });
  if (!sub) return { ok: false, error: "Subscription not found" };

  const pm = await db.paymentMethod.findUnique({ where: { merchantId: sub.merchantId } });
  if (!pm?.recurringId) return { ok: false, error: "No saved payment method" };

  const amountSar = priceWithVat(sub.plan);
  // Create a PENDING charge first
  const charge = await db.charge.create({
    data: {
      subscriptionId: sub.id,
      amountSar: Math.round(amountSar * 100),
      status: "PENDING",
      provider: "MYFATOORAH",
    },
  });

  try {
    const data = await myfatoorahClient.request<{
      InvoiceId: number;
      PaymentId: string;
      InvoiceStatus: string;
    }>("POST", "/v2/ExecutePayment", {
      body: {
        PaymentMethodId: 0, // 0 = use recurring token
        RecurringId: pm.recurringId,
        InvoiceValue: amountSar,
        CustomerEmail: sub.merchant.ownerEmail,
        CallBackUrl: `${env.NEXT_PUBLIC_APP_URL}/api/billing/recurring-callback`,
        ErrorUrl: `${env.NEXT_PUBLIC_APP_URL}/api/billing/recurring-callback`,
        DisplayCurrencyIso: "SAR",
        CustomerReference: sub.merchantId,
      },
    });

    const succeeded = data.InvoiceStatus === "Paid";
    const now = new Date();
    const nextPeriodEnd = new Date(now);
    nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);

    await db.charge.update({
      where: { id: charge.id },
      data: {
        status: succeeded ? "SUCCEEDED" : "FAILED",
        providerInvoiceId: String(data.InvoiceId),
        providerPaymentId: data.PaymentId,
        succeededAt: succeeded ? now : null,
        failureReason: succeeded ? null : data.InvoiceStatus,
      },
    });

    if (succeeded) {
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          currentPeriodEnd: nextPeriodEnd,
          providerRef: String(data.InvoiceId),
        },
      });
    } else {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "PAST_DUE" },
      });
    }

    return {
      ok: true,
      data: { chargeId: charge.id, status: succeeded ? "SUCCEEDED" : "FAILED" },
    };
  } catch (e) {
    Sentry.captureException(e, { tags: { action: "chargeRecurring", subscriptionId } });
    await db.charge.update({
      where: { id: charge.id },
      data: {
        status: "FAILED",
        failureReason: (e as Error).message ?? "unknown",
      },
    });
    await db.subscription.update({
      where: { id: sub.id },
      data: { status: "PAST_DUE" },
    });
    return { ok: false, error: "Charge failed" };
  }
}
