import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { getPostHogServer } from "@/lib/posthog";
import { verifyPassKitSignature } from "@/lib/passkit/webhooks";
import { PassKitWebhookEvent } from "@/lib/passkit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-passkit-signature");
  const timestamp = req.headers.get("x-passkit-timestamp");

  try {
    verifyPassKitSignature({ rawBody, signature, timestamp });
  } catch (e) {
    Sentry.captureException(e, { tags: { vendor: "passkit", stage: "webhook-verify" } });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = PassKitWebhookEvent.parse(JSON.parse(rawBody));
  } catch (e) {
    Sentry.captureException(e, { tags: { vendor: "passkit", stage: "webhook-parse" } });
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    switch (parsed.event) {
      case "pass.installed":
        Sentry.addBreadcrumb({ category: "passkit", message: `pass.installed ${parsed.passId}` });
        break;

      case "pass.removed":
        await db.pass.update({
          where: { passKitPassId: parsed.passId },
          data: { status: "DELETED" },
        });
        break;

      case "pass.viewed": {
        const posthog = getPostHogServer();
        if (posthog) {
          posthog.capture({
            distinctId: parsed.passId,
            event: "pass_viewed",
            properties: { programId: parsed.programId },
          });
        }
        break;
      }
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { vendor: "passkit", event: parsed.event, passId: parsed.passId } });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
