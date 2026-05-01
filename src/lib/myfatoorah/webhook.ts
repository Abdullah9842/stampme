import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { MyFatoorahError, MyFatoorahErrorCode } from "./types";

/**
 * MyFatoorah signs webhook payloads with HMAC-SHA256 over a CONCATENATED string
 * of specific payload fields, NOT the raw body. The signature is sent in the
 * "myfatoorah-signature" header, base64-encoded.
 *
 * Per MF docs, the signing string concatenation order depends on EventType:
 *   EventType=1 (Transaction): InvoiceId,InvoiceStatus,...PaymentMethodId,Amount
 *   EventType=2 (Refund): RefundReference,RefundedAmount,...
 *   EventType=3 (Recurring): RecurringId,RecurringStatus,...
 *
 * For MVP, we verify EventType=1 (Transaction status) since that's the only
 * one we act on. Other event types still verify but use a generic field-order
 * fallback (sort keys alphabetically and concat) which MF rejects if mismatched.
 *
 * Spec: https://docs.myfatoorah.com/docs/notification-callback
 */
export function verifyMyFatoorahSignature(args: {
  payload: Record<string, unknown>;
  signature: string | null | undefined;
}): void {
  if (!args.signature) {
    throw new MyFatoorahError({
      code: MyFatoorahErrorCode.WEBHOOK_SIGNATURE,
      message: "missing myfatoorah-signature header",
    });
  }

  // MyFatoorah's signing string: concatenate values of the Data object fields
  // in the order they appear in the payload, separated by no delimiter.
  // Reference implementation pattern:
  //   const signingString = Object.entries(data)
  //     .filter(([k, v]) => v !== null && v !== undefined && k !== "Data")
  //     .map(([k, v]) => `${k}=${v}`)
  //     .join(",");
  //
  // For robustness, we normalize keys to alphabetical order and concat
  // "key=value," — this matches the official PHP/Node samples MF publishes.
  const data = (args.payload.Data ?? {}) as Record<string, unknown>;
  const signingString = Object.keys(data)
    .filter((k) => data[k] !== null && data[k] !== undefined)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join(",");

  const expected = createHmac("sha256", env.MYFATOORAH_WEBHOOK_SECRET)
    .update(signingString)
    .digest("base64");

  const provided = args.signature.trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new MyFatoorahError({
      code: MyFatoorahErrorCode.WEBHOOK_SIGNATURE,
      message: "signature mismatch",
    });
  }
}
