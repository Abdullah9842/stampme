import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import slugify from "slugify";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clerkUserCreatedSchema } from "@/lib/validation";

export const runtime = "nodejs";

function slugForMerchant(name: string, fallback: string): string {
  const base = slugify(name, { lower: true, strict: true, locale: "ar" }) || fallback;
  return base;
}

export async function POST(req: NextRequest) {
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse("Missing svix headers", { status: 400 });
  }

  const rawBody = await req.text();
  const wh = new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET);

  let event: unknown;
  try {
    event = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (err) {
    console.error("[clerk webhook] signature verification failed", err);
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const parsed = clerkUserCreatedSchema.safeParse(event);
  if (!parsed.success) {
    return NextResponse.json({ ignored: true });
  }

  const {
    id: clerkUserId,
    email_addresses,
    primary_email_address_id,
    phone_numbers,
    primary_phone_number_id,
    first_name,
    last_name,
  } = parsed.data.data;

  const primaryEmail =
    email_addresses.find((e) => e.id === primary_email_address_id)?.email_address ??
    email_addresses[0]?.email_address;
  const primaryPhone =
    phone_numbers.find((p) => p.id === primary_phone_number_id)?.phone_number ??
    phone_numbers[0]?.phone_number ??
    "";

  if (!primaryEmail) {
    return new NextResponse("No primary email", { status: 400 });
  }

  const inferredName =
    [first_name, last_name].filter(Boolean).join(" ").trim() || primaryEmail.split("@")[0]!;

  const baseSlug = slugForMerchant(inferredName, clerkUserId.slice(-8).toLowerCase());
  let slug = baseSlug;
  for (let i = 0; i < 5; i++) {
    const existing = await db.merchant.findUnique({ where: { slug } });
    if (!existing) break;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  await db.merchant.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      name: inferredName,
      slug,
      ownerEmail: primaryEmail,
      ownerPhone: primaryPhone,
      vertical: "OTHER",
      brandColor: "#0A7C36",
    },
  });

  return NextResponse.json({ ok: true });
}
