import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { PassKitError, PassKitErrorCode } from "./types";

const TOLERANCE_SECONDS = 5 * 60;

export interface VerifyArgs {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}

export function verifyPassKitSignature({ rawBody, signature, timestamp }: VerifyArgs): void {
  if (!signature || !timestamp) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "missing signature or timestamp",
    });
  }
  if (!signature.startsWith("sha256=")) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "malformed signature header",
    });
  }
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "invalid timestamp",
    });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > TOLERANCE_SECONDS) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: `timestamp outside tolerance (${nowSec - ts}s)`,
    });
  }
  const expected = createHmac("sha256", env.PASSKIT_WEBHOOK_SECRET)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  const provided = signature.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new PassKitError({
      code: PassKitErrorCode.WEBHOOK_SIGNATURE,
      message: "signature mismatch",
    });
  }
}
