import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { verifyMyFatoorahSignature } from "@/lib/myfatoorah/webhook";
import { MyFatoorahWebhookEvent } from "@/lib/myfatoorah/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("myfatoorah-signature");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    verifyMyFatoorahSignature({ payload: payload as Record<string, unknown>, signature });
  } catch (e) {
    Sentry.captureException(e, { tags: { vendor: "myfatoorah", stage: "webhook-verify" } });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const parsed = MyFatoorahWebhookEvent.safeParse(payload);
  if (!parsed.success) {
    Sentry.captureException(parsed.error, { tags: { vendor: "myfatoorah", stage: "webhook-parse" } });
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const ev = parsed.data;
  Sentry.addBreadcrumb({
    category: "myfatoorah",
    message: `${ev.Event}`,
    level: "info",
    data: { EventType: ev.EventType, InvoiceId: ev.Data.InvoiceId, RecurringId: ev.Data.RecurringId },
  });

  try {
    if (ev.EventType === 1) {
      // Transaction status update
      const invoiceId = ev.Data.InvoiceId;
      const status = ev.Data.InvoiceStatus;
      if (invoiceId && status) {
        const charge = await db.charge.findFirst({
          where: { providerInvoiceId: String(invoiceId) },
        });
        if (charge) {
          const newStatus = status === "Paid" ? "SUCCEEDED" : status === "Failed" ? "FAILED" : "PENDING";
          await db.charge.update({
            where: { id: charge.id },
            data: {
              status: newStatus,
              succeededAt: newStatus === "SUCCEEDED" ? new Date() : null,
              failureReason: newStatus === "FAILED" ? status : null,
            },
          });
        }
      }
    } else if (ev.EventType === 3) {
      // Recurring status update — token revoked, expired, etc.
      const recurringId = ev.Data.RecurringId;
      const status = ev.Data.PaymentStatus;
      if (recurringId && (status === "Cancelled" || status === "Expired" || status === "Failed")) {
        // Token no longer valid — drop our reference
        await db.paymentMethod.deleteMany({
          where: { recurringId },
        });
      }
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { vendor: "myfatoorah", event: ev.Event } });
    // Return 200 anyway — don't make MyFatoorah retry; log and move on
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
