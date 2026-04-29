import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createProgram } from "@/lib/passkit/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await createProgram({
      merchantId: "debug-merchant-" + Date.now(),
      name: "Debug Program " + Date.now(),
      brandColor: "#0F4C3A",
      logoUrl: "https://example.com/logo.png",
      rewardLabel: "Free coffee",
      stampsRequired: 10,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const err = e as {
      code?: number | string;
      details?: string;
      message?: string;
      name?: string;
      stack?: string;
      cause?: unknown;
      upstream?: unknown;
    };
    return NextResponse.json({
      ok: false,
      name: err.name,
      message: err.message,
      code: err.code,
      details: err.details,
      stack: err.stack?.split("\n").slice(0, 12),
      cause: err.cause ? String(err.cause) : undefined,
      upstream: err.upstream ? JSON.stringify(err.upstream).slice(0, 500) : undefined,
    });
  }
}
