import { S3Client } from "@aws-sdk/client-s3";

let r2: S3Client | null = null;

export function getR2(): S3Client {
  if (r2) return r2;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Cloudflare R2 env vars are not set");
  }
  r2 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return r2;
}

export const R2_BUCKET = process.env.R2_BUCKET ?? "stampme-assets";
export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? "";
