import { z } from "zod";

export const PassKitErrorCode = {
  NETWORK: "NETWORK",
  AUTH: "AUTH",
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM: "UPSTREAM",
  WEBHOOK_SIGNATURE: "WEBHOOK_SIGNATURE",
  UNKNOWN: "UNKNOWN",
} as const;
export type PassKitErrorCode = (typeof PassKitErrorCode)[keyof typeof PassKitErrorCode];

export class PassKitError extends Error {
  readonly code: PassKitErrorCode;
  readonly status?: number;
  readonly upstream?: unknown;

  constructor(opts: {
    code: PassKitErrorCode;
    message: string;
    status?: number;
    cause?: unknown;
    upstream?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "PassKitError";
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

// Inputs
export const CreateProgramInput = z.object({
  merchantId: z.string().min(1),
  name: z.string().min(1).max(60),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  logoUrl: z.string().url(),
  rewardLabel: z.string().min(1).max(60),
  stampsRequired: z.number().int().min(1).max(20),
});
export type CreateProgramInput = z.infer<typeof CreateProgramInput>;

export const UpdateProgramTemplateInput = CreateProgramInput.omit({ merchantId: true })
  .extend({ programId: z.string().min(1) });
export type UpdateProgramTemplateInput = z.infer<typeof UpdateProgramTemplateInput>;

export const IssuePassInput = z.object({
  programId: z.string().min(1),
  customerPhone: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  idempotencyKey: z.string().min(8),
});
export type IssuePassInput = z.infer<typeof IssuePassInput>;

export const UpdatePassStampsInput = z.object({
  passKitPassId: z.string().min(1),
  stampsCount: z.number().int().min(0).max(50),
  idempotencyKey: z.string().min(8),
});
export type UpdatePassStampsInput = z.infer<typeof UpdatePassStampsInput>;

export const MarkRedeemedInput = z.object({
  passKitPassId: z.string().min(1),
  idempotencyKey: z.string().min(8),
});
export type MarkRedeemedInput = z.infer<typeof MarkRedeemedInput>;

// Outputs
export interface CreateProgramOutput {
  passKitProgramId: string;
  passKitTemplateId: string;
}
export interface IssuePassOutput {
  passKitPassId: string;
  applePassUrl: string;
  googleWalletUrl: string;
}

// Webhook events
export const PassKitWebhookEvent = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("pass.installed"),
    passId: z.string(),
    programId: z.string(),
    platform: z.enum(["apple", "google"]),
    timestamp: z.string().datetime(),
  }),
  z.object({
    event: z.literal("pass.removed"),
    passId: z.string(),
    programId: z.string(),
    platform: z.enum(["apple", "google"]),
    timestamp: z.string().datetime(),
  }),
  z.object({
    event: z.literal("pass.viewed"),
    passId: z.string(),
    programId: z.string(),
    timestamp: z.string().datetime(),
  }),
]);
export type PassKitWebhookEvent = z.infer<typeof PassKitWebhookEvent>;
