import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateQrPosterPdf } from "@/lib/qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ merchantId: string }> }) {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { merchantId } = await ctx.params;
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, clerkUserId: userId },
  });
  if (!merchant) return new NextResponse("Forbidden", { status: 403 });

  const pdf = await generateQrPosterPdf({
    merchantName: merchant.name,
    merchantLogoUrl: merchant.logoUrl,
    brandColor: merchant.brandColor,
    slug: merchant.slug,
  });

  // NextResponse with a Buffer — convert to Uint8Array for proper streaming
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${merchant.slug}-poster.pdf"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
