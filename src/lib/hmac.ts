import { createHmac, timingSafeEqual, type BinaryToTextEncoding } from "node:crypto";
import { env } from "@/lib/env";

const ENC = "base64url" as BinaryToTextEncoding;

function compute(slug: string, exp: number): string {
  return createHmac("sha256", env.ENROLLMENT_HMAC_SECRET)
    .update(`${slug}.${exp}`)
    .digest(ENC);
}

export function signEnrollmentUrl(slug: string, expiresAt: number): string {
  const sig = compute(slug, expiresAt);
  const url = new URL(`/c/${slug}`, env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set("sig", sig);
  url.searchParams.set("exp", String(expiresAt));
  return url.toString();
}

export function verifyEnrollmentSignature(
  slug: string,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = Buffer.from(compute(slug, exp), ENC);
    provided = Buffer.from(sig, ENC);
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
