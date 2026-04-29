import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMarginAlert } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAR_TO_USD = 0.2667;
const PLAN_REVENUE_SAR: Record<string, number> = {
  STARTER: 99,
  GROWTH: 249,
  PRO: 499,
};
const ALERT_THRESHOLD = 0.60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const merchants = await db.merchant.findMany({
    where: { subscription: { status: { in: ["ACTIVE", "TRIALING"] } } },
    include: { subscription: true, programs: { select: { id: true } } },
  });

  let alerted = 0;
  for (const m of merchants) {
    if (!m.subscription) continue;
    const programIds = m.programs.map((p: { id: string }) => p.id);
    if (programIds.length === 0) continue;

    const passCount = await db.pass.count({
      where: {
        programId: { in: programIds },
        status: { not: "ISSUE_FAILED" },
        createdAt: { gte: startOfMonth },
      },
    });

    const costUsd = passCount * env.MARGIN_PASS_COST_USD;
    const revenueSar = PLAN_REVENUE_SAR[m.subscription.plan] ?? 0;
    const revenueUsd = revenueSar * SAR_TO_USD;
    if (revenueUsd === 0) continue;

    const ratio = costUsd / revenueUsd;
    if (ratio > ALERT_THRESHOLD) {
      try {
        await sendMarginAlert({
          to: env.MARGIN_ALERT_EMAIL,
          merchantName: m.name,
          merchantId: m.id,
          passesIssued: passCount,
          costUsd,
          revenueUsd,
          ratio,
        });
        alerted++;
      } catch (e) {
        Sentry.captureException(e, { tags: { stage: "margin-alert", merchantId: m.id } });
      }
    }
  }

  return NextResponse.json({ ok: true, merchantsScanned: merchants.length, alerted });
}
