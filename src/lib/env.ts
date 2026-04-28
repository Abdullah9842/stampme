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

  HYPERPAY_ENV: z.enum(["test", "live"]).default("test"),
  HYPERPAY_BASE_URL: urlWithDefault("https://eu-test.oppwa.com"),
  HYPERPAY_ACCESS_TOKEN: z.string().optional(),
  HYPERPAY_ENTITY_ID_MADA: z.string().optional(),
  HYPERPAY_ENTITY_ID_CARD: z.string().optional(),
  HYPERPAY_WEBHOOK_KEY_HEX: z.string().optional(),

  PASSKIT_API_URL: urlWithDefault("https://api.pub1.passkit.io"),
  PASSKIT_API_KEY: z.string().optional(),
  PASSKIT_PUBLIC_KEY: z.string().optional(),
  PASSKIT_PRIVATE_KEY: z.string().optional(),
  PASSKIT_WEBHOOK_SECRET: z.string().optional(),
  PASSKIT_DEFAULT_TEMPLATE_ID: z.string().optional(),

  CRON_SECRET: z.string().optional(),
  STAFF_JWT_SECRET: z.string().optional(),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  UNIFONIC_APP_SID: z.string().optional(),
  UNIFONIC_SENDER_NAME: z.string().optional(),
});

const skipValidation = process.env.SKIP_ENV_VALIDATION === "true";

const parsed = skipValidation
  ? (process.env as unknown as z.infer<typeof schema>)
  : schema.parse(process.env);

export const env = parsed;
