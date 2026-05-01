"use server";

import "server-only";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { getCurrentMerchant } from "@/lib/auth/current-merchant";
import { authedMerchantLimiter } from "@/lib/ratelimit";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/svg+xml", "image/jpeg", "image/webp"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function uploadLogo(formData: FormData): Promise<UploadResult> {
  // Derive merchant from session — never trust client-provided merchantId
  let merchant;
  try {
    merchant = await getCurrentMerchant();
  } catch {
    return { ok: false, error: "Not authenticated" };
  }
  if (!merchant) {
    return { ok: false, error: "Onboarding required before uploads" };
  }

  const rl = await authedMerchantLimiter.limit(merchant.id);
  if (!rl.success) {
    return { ok: false, error: "Too many requests, slow down" };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file provided" };
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: `Unsupported file type: ${file.type}` };
  }

  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File too large (max 2MB)" };
  }

  const ext = EXT_BY_MIME[file.type];
  const key = `merchants/${merchant.id}/logo.${ext}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await getR2().send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        // Short TTL with must-revalidate — logo key is deterministic so re-uploads
        // need the CDN/browser to recheck. TODO: switch to content-hashed key for
        // longer cache lifetime once the merchant card preview supports cache-bust.
        CacheControl: "public, max-age=300, must-revalidate",
      }),
    );
    return { ok: true, url: `${R2_PUBLIC_URL}/${key}` };
  } catch (err) {
    console.error("[uploadLogo] R2 upload failed", err);
    return { ok: false, error: "Upload failed, try again" };
  }
}
