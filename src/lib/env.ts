import { z } from "zod";

const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);

const urlWithDefault = (fallback: string) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().url().default(fallback));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_"),

  NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),

  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: optionalUrl,

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: optionalUrl,

  MYFATOORAH_API_KEY: z.string().min(20),
  MYFATOORAH_BASE_URL: z.string().url(),
  MYFATOORAH_WEBHOOK_SECRET: z.string().min(10),

  // Safety flag — never auto-charge without explicit user action (default false)
  BILLING_AUTO_CHARGE_ENABLED: z.coerce.boolean().default(false),

  // PassKit gRPC mTLS credentials — multi-line PEM strings.
  // Obtain from PassKit dashboard → Developer Tools → SDK Credentials.
  PASSKIT_CERTIFICATE: z.string().min(1),
  PASSKIT_KEY: z.string().min(1),
  PASSKIT_CA_CHAIN: z.string().min(1),
  PASSKIT_WEBHOOK_SECRET: z.string().min(1),
  PASSKIT_DEFAULT_TEMPLATE_ID: z.string().optional(),
  MARGIN_ALERT_EMAIL: z.string().email(),
  MARGIN_PASS_COST_USD: z.coerce.number().positive(),

  CRON_SECRET: z.string().min(32),
  STAFF_JWT_SECRET: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(20),
  ENROLLMENT_HMAC_SECRET: z.string().min(32, "must be at least 32 chars"),

  UNIFONIC_APP_SID: z.string().optional(),
  UNIFONIC_SENDER_NAME: z.string().optional(),
});

const skipValidation = process.env.SKIP_ENV_VALIDATION === "true";

const parsed = skipValidation
  ? (process.env as unknown as z.infer<typeof schema>)
  : schema.parse(process.env);

export const env = parsed;
