import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { applyPaymentResult } from "@/lib/actions/billing";
import { env } from "@/lib/env";
import type { Plan } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const merchantId = url.searchParams.get("merchantId");
  const plan = url.searchParams.get("plan") as Plan | null;
  // MyFatoorah passes paymentId=... or Id=... — try both
  const paymentId = url.searchParams.get("paymentId") ?? url.searchParams.get("Id");

  if (!merchantId || !plan || !paymentId) {
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/ar/settings?billing=error&reason=missing-params`);
  }

  // The paymentId is from the URL. We need to fetch the invoiceId via getPaymentStatus
  // by passing Key=paymentId, KeyType=PaymentId. applyPaymentResult expects invoiceId
  // — adapt: pass paymentId via getPaymentStatus first.
  // Simplest: the callback URL includes paymentId. We do lookup by PaymentId, not InvoiceId.
  try {
    // Re-fetch status with KeyType=PaymentId
    const { myfatoorahClient } = await import("@/lib/myfatoorah/client");
    const status = await myfatoorahClient.request<{ InvoiceId: number }>(
      "POST",
      "/v2/getPaymentStatus",
      { body: { Key: paymentId, KeyType: "PaymentId" } },
    );
    const invoiceId = status.InvoiceId;
    const result = await applyPaymentResult({ merchantId, plan, invoiceId });

    if (result.ok && result.data?.status === "ACTIVE") {
      return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/ar/settings?billing=success`);
    }
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/ar/settings?billing=failed`);
  } catch (e) {
    Sentry.captureException(e, { tags: { route: "billing-callback", merchantId } });
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/ar/settings?billing=error`);
  }
}
