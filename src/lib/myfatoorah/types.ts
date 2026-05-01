import { z } from "zod";

export const MyFatoorahErrorCode = {
  NETWORK: "NETWORK",
  AUTH: "AUTH",
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM: "UPSTREAM",
  WEBHOOK_SIGNATURE: "WEBHOOK_SIGNATURE",
  UNKNOWN: "UNKNOWN",
} as const;
export type MyFatoorahErrorCode = (typeof MyFatoorahErrorCode)[keyof typeof MyFatoorahErrorCode];

export class MyFatoorahError extends Error {
  readonly code: MyFatoorahErrorCode;
  readonly status?: number;
  readonly upstream?: unknown;

  constructor(opts: {
    code: MyFatoorahErrorCode;
    message: string;
    status?: number;
    cause?: unknown;
    upstream?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "MyFatoorahError";
    this.code = opts.code;
    this.status = opts.status;
    this.upstream = opts.upstream;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
    };
  }
}

// Request/response Zod schemas (skeleton — Phase B will use these)
export const InitiateSessionInput = z.object({
  customerIdentifier: z.string().min(1),
});
export type InitiateSessionInput = z.infer<typeof InitiateSessionInput>;

export const ExecutePaymentInput = z.object({
  invoiceValue: z.number().positive(),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  callbackUrl: z.string().url(),
  errorUrl: z.string().url(),
  paymentMethodId: z.number().int().optional(),
  recurringId: z.string().optional(),
  language: z.enum(["EN", "AR"]).default("AR"),
  customerReference: z.string().optional(),
});
export type ExecutePaymentInput = z.infer<typeof ExecutePaymentInput>;

// Webhook payload event types
export const MyFatoorahWebhookEvent = z.object({
  EventType: z.number(), // 1=Transaction Status, 2=Refund, 3=Recurring Status
  Event: z.string(),
  CountryIsoCode: z.string().optional(),
  Data: z
    .object({
      InvoiceId: z.coerce.number().optional(),
      InvoiceStatus: z.string().optional(),
      InvoiceReference: z.string().optional(),
      PaymentId: z.string().optional(),
      CustomerReference: z.string().optional(),
      RecurringId: z.string().optional(),
      PaymentStatus: z.string().optional(),
      Amount: z.coerce.number().optional(),
      Currency: z.string().optional(),
    })
    .passthrough(),
});
export type MyFatoorahWebhookEvent = z.infer<typeof MyFatoorahWebhookEvent>;
