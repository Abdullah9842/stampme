"use server";

import "server-only";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { getClerkUserIdOrThrow } from "@/lib/auth/current-merchant";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/svg+xml", "image/jpeg", "image/webp"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const formSchema = z.object({
  merchantId: z.string().min(1).max(64),
});

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function uploadLogo(formData: FormData): Promise<UploadResult> {
  try {
    await getClerkUserIdOrThrow();
  } catch {
    return { ok: false, error: "Not authenticated" };
  }

  const parsed = formSchema.safeParse({
    merchantId: formData.get("merchantId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid merchantId" };
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
  const key = `merchants/${parsed.data.merchantId}/logo.${ext}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await getR2().send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return { ok: true, url: `${R2_PUBLIC_URL}/${key}` };
  } catch (err) {
    console.error("[uploadLogo] R2 upload failed", err);
    return { ok: false, error: "Upload failed, try again" };
  }
}
