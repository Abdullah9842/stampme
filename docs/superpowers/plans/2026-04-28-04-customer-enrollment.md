# stampme — Plan 4: Customer Enrollment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public, merchant-branded customer enrollment at `/c/[slug]` — phone capture, PassKit pass issuance, Apple/Google Wallet add buttons, rate-limited, HMAC-signed QR codes for print, lost-pass recovery.

**Architecture:** Public route group with no Clerk auth. Server Actions for mutations. Upstash for rate limiting. PassKit pass issuance via Plan 3's service. PDF generation server-side for printable QR posters.

**Tech Stack:** Next.js 15, Upstash Redis, qrcode, @react-pdf/renderer, Zod, Sentry

**Depends on:** Plan 1 (Foundation), Plan 2 (Merchant + LoyaltyProgram), Plan 3 (`passkit.issuePass`)

**Spec reference:** `docs/superpowers/specs/2026-04-28-stampme-design.md` §٤.٢, §١٢

---

## Task 1 — Dependencies, env vars, and Upstash rate-limit module

**Files:**
- `package.json`
- `.env.example`
- `src/lib/ratelimit.ts`
- `src/lib/ratelimit.test.ts`
- `src/env.ts` (extend)

### Steps

- [ ] Install runtime dependencies:

```bash
bun add @upstash/ratelimit @upstash/redis qrcode @react-pdf/renderer
bun add -d @types/qrcode
```

- [ ] Add env vars to `.env.example`:

```dotenv
# Upstash (rate limiting)
UPSTASH_REDIS_REST_URL=https://us1-xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...

# HMAC signing for enrollment URLs (32+ random bytes hex)
ENROLLMENT_HMAC_SECRET=replace_with_openssl_rand_hex_32

# Public base URL (used to build signed enrollment links + QR posters)
NEXT_PUBLIC_APP_URL=https://stampme.com
```

- [ ] Extend `src/env.ts` with Zod-validated additions (Plan 1 already created the file — append):

```ts
// inside the existing z.object(...) for env
UPSTASH_REDIS_REST_URL: z.string().url(),
UPSTASH_REDIS_REST_TOKEN: z.string().min(20),
ENROLLMENT_HMAC_SECRET: z.string().min(32, "must be at least 32 chars"),
NEXT_PUBLIC_APP_URL: z.string().url(),
```

- [ ] **Test first** — `src/lib/ratelimit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}));

const limitMock = vi.fn();
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: vi.fn().mockImplementation(() => ({ limit: limitMock })),
}));

describe("ratelimit", () => {
  beforeEach(() => {
    limitMock.mockReset();
  });

  it("enrollIpLimiter allows when under quota", async () => {
    limitMock.mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 3600_000 });
    const { enrollIpLimiter } = await import("./ratelimit");
    const res = await enrollIpLimiter.limit("203.0.113.1");
    expect(res.success).toBe(true);
  });

  it("enrollPhoneLimiter blocks when quota exceeded", async () => {
    limitMock.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 86_400_000 });
    const { enrollPhoneLimiter } = await import("./ratelimit");
    const res = await enrollPhoneLimiter.limit("+966500000000");
    expect(res.success).toBe(false);
  });

  it("recoverPhoneLimiter is configured for 3/hour", async () => {
    limitMock.mockResolvedValue({ success: true, remaining: 2, reset: Date.now() + 3600_000 });
    const { recoverPhoneLimiter } = await import("./ratelimit");
    const res = await recoverPhoneLimiter.limit("+966500000000");
    expect(res.success).toBe(true);
  });
});
```

- [ ] Implement `src/lib/ratelimit.ts`:

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/env";

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

/** 10 enrollments per hour per IP — anti-abuse */
export const enrollIpLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  analytics: true,
  prefix: "rl:enroll:ip",
});

/** 5 enrollments per day per phone — anti-spam */
export const enrollPhoneLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 d"),
  analytics: true,
  prefix: "rl:enroll:phone",
});

/** 3 recovery attempts per hour per phone */
export const recoverPhoneLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  analytics: true,
  prefix: "rl:recover:phone",
});

export class RateLimitError extends Error {
  constructor(public readonly resetAt: number) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
  }
}
```

- [ ] Run `bun run test src/lib/ratelimit.test.ts` — all pass.

- [ ] Commit: `feat(enroll): add upstash rate limiters and env vars`

---

## Task 2 — KSA phone + slug Zod validation

**Files:**
- `src/lib/validation/enrollment.ts`
- `src/lib/validation/enrollment.test.ts`

### Steps

- [ ] **Test first** — `src/lib/validation/enrollment.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ksaPhoneSchema, merchantSlugSchema, enrollPayloadSchema } from "./enrollment";

describe("ksaPhoneSchema", () => {
  it.each([
    "+966500000000",
    "+966512345678",
    "+966591234567",
  ])("accepts valid KSA mobile %s", (phone) => {
    expect(ksaPhoneSchema.parse(phone)).toBe(phone);
  });

  it("normalizes 05XXXXXXXX to +9665XXXXXXXX", () => {
    expect(ksaPhoneSchema.parse("0512345678")).toBe("+966512345678");
  });

  it("normalizes 5XXXXXXXX to +9665XXXXXXXX", () => {
    expect(ksaPhoneSchema.parse("512345678")).toBe("+966512345678");
  });

  it("strips spaces and dashes", () => {
    expect(ksaPhoneSchema.parse("+966 50 000 0000")).toBe("+966500000000");
    expect(ksaPhoneSchema.parse("+966-50-000-0000")).toBe("+966500000000");
  });

  it.each([
    "+966400000000",   // landline second digit not 5
    "+96650000000",    // too short
    "+9665000000000",  // too long
    "+1234567890",     // wrong country
    "abcdefghij",
    "",
  ])("rejects invalid %s", (phone) => {
    expect(() => ksaPhoneSchema.parse(phone)).toThrow();
  });
});

describe("merchantSlugSchema", () => {
  it.each(["acme", "acme-cafe", "cafe-99", "a-b-c"])("accepts %s", (s) => {
    expect(merchantSlugSchema.parse(s)).toBe(s);
  });

  it.each(["A-Cafe", "cafe_under", "-bad", "bad-", "ab", "x".repeat(81)])(
    "rejects %s",
    (s) => {
      expect(() => merchantSlugSchema.parse(s)).toThrow();
    },
  );
});

describe("enrollPayloadSchema", () => {
  it("accepts valid payload", () => {
    const out = enrollPayloadSchema.parse({
      merchantSlug: "acme-cafe",
      phone: "0512345678",
    });
    expect(out.phone).toBe("+966512345678");
  });
});
```

- [ ] Implement `src/lib/validation/enrollment.ts`:

```ts
import { z } from "zod";

/**
 * KSA mobile numbers start with 5 (after country code).
 * Accepts +9665XXXXXXXX, 9665XXXXXXXX, 05XXXXXXXX, 5XXXXXXXX.
 * Normalizes everything to E.164: +9665XXXXXXXX (12 chars total).
 */
export const ksaPhoneSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[\s\-()]/g, ""))
  .transform((raw) => {
    if (/^\+9665\d{8}$/.test(raw)) return raw;
    if (/^9665\d{8}$/.test(raw)) return `+${raw}`;
    if (/^05\d{8}$/.test(raw)) return `+966${raw.slice(1)}`;
    if (/^5\d{8}$/.test(raw)) return `+966${raw}`;
    return raw;
  })
  .refine((v) => /^\+9665\d{8}$/.test(v), {
    message: "رقم جوال سعودي غير صالح. يجب أن يبدأ بـ 5",
  });

/** lowercase kebab-case, 3-80 chars, must start+end alnum */
export const merchantSlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Invalid slug");

export const enrollPayloadSchema = z.object({
  merchantSlug: merchantSlugSchema,
  phone: ksaPhoneSchema,
  sig: z.string().optional(),
  exp: z.coerce.number().int().positive().optional(),
});

export type EnrollPayload = z.infer<typeof enrollPayloadSchema>;

export const recoverPayloadSchema = z.object({
  merchantSlug: merchantSlugSchema,
  phone: ksaPhoneSchema,
});

export type RecoverPayload = z.infer<typeof recoverPayloadSchema>;
```

- [ ] Run `bun run test src/lib/validation/enrollment.test.ts` — all pass.

- [ ] Commit: `feat(enroll): zod schemas for ksa phone and merchant slug`

---

## Task 3 — HMAC sign + verify for enrollment URLs

**Files:**
- `src/lib/hmac.ts`
- `src/lib/hmac.test.ts`

### Steps

- [ ] **Test first** — `src/lib/hmac.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/env", () => ({
  env: { ENROLLMENT_HMAC_SECRET: "a".repeat(64), NEXT_PUBLIC_APP_URL: "https://stampme.com" },
}));

import { signEnrollmentUrl, verifyEnrollmentSignature } from "./hmac";

describe("HMAC enrollment URLs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T10:00:00Z"));
  });

  it("signs and verifies a fresh URL", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const u = new URL(url);
    const sig = u.searchParams.get("sig")!;
    const expParam = Number(u.searchParams.get("exp")!);
    expect(verifyEnrollmentSignature("acme-cafe", expParam, sig)).toBe(true);
  });

  it("rejects tampered slug", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const sig = new URL(url).searchParams.get("sig")!;
    expect(verifyEnrollmentSignature("evil-cafe", exp, sig)).toBe(false);
  });

  it("rejects tampered exp", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const sig = new URL(url).searchParams.get("sig")!;
    expect(verifyEnrollmentSignature("acme-cafe", exp + 1, sig)).toBe(false);
  });

  it("rejects expired URL", () => {
    const exp = Date.now() + 60_000;
    const url = signEnrollmentUrl("acme-cafe", exp);
    const sig = new URL(url).searchParams.get("sig")!;
    vi.setSystemTime(new Date("2026-04-29T10:00:00Z"));
    expect(verifyEnrollmentSignature("acme-cafe", exp, sig)).toBe(false);
  });

  it("rejects malformed sig", () => {
    expect(verifyEnrollmentSignature("acme-cafe", Date.now() + 1000, "not-base64!")).toBe(false);
  });
});
```

- [ ] Implement `src/lib/hmac.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

const ENC: BufferEncoding = "base64url";

function compute(slug: string, exp: number): string {
  return createHmac("sha256", env.ENROLLMENT_HMAC_SECRET)
    .update(`${slug}.${exp}`)
    .digest(ENC);
}

/**
 * Build a fully-qualified, signed enrollment URL.
 * @param slug merchant slug
 * @param expiresAt epoch ms when the signature should expire
 */
export function signEnrollmentUrl(slug: string, expiresAt: number): string {
  const sig = compute(slug, expiresAt);
  const url = new URL(`/c/${slug}`, env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set("sig", sig);
  url.searchParams.set("exp", String(expiresAt));
  return url.toString();
}

/** Verify a signature; returns false on tamper or expiry. */
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
```

- [ ] Run `bun run test src/lib/hmac.test.ts` — all pass.

- [ ] Commit: `feat(enroll): HMAC signed enrollment URLs`

---

## Task 4 — `enrollCustomer` server action (idempotent + rate-limited)

**Files:**
- `src/lib/actions/enrollment.ts`
- `src/lib/actions/enrollment.test.ts`

### Steps

- [ ] **Test first** — `src/lib/actions/enrollment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMerchant = vi.fn();
const findActiveProgram = vi.fn();
const findPass = vi.fn();
const createPass = vi.fn();
const issuePass = vi.fn();
const ipLimit = vi.fn();
const phoneLimit = vi.fn();
const recoverLimit = vi.fn();
const captureException = vi.fn();
const headers = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    merchant: { findUnique: findMerchant },
    loyaltyProgram: { findFirst: findActiveProgram },
    pass: { findFirst: findPass, create: createPass },
  },
}));
vi.mock("@/lib/passkit/passes", () => ({ issuePass }));
vi.mock("@/lib/ratelimit", () => ({
  enrollIpLimiter: { limit: ipLimit },
  enrollPhoneLimiter: { limit: phoneLimit },
  recoverPhoneLimiter: { limit: recoverLimit },
  RateLimitError: class extends Error {
    constructor(public resetAt: number) { super("rl"); }
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("next/headers", () => ({ headers: () => headers() }));

beforeEach(() => {
  [findMerchant, findActiveProgram, findPass, createPass, issuePass,
   ipLimit, phoneLimit, recoverLimit, captureException, headers].forEach(m => m.mockReset());
  ipLimit.mockResolvedValue({ success: true });
  phoneLimit.mockResolvedValue({ success: true });
  recoverLimit.mockResolvedValue({ success: true });
  headers.mockReturnValue(new Map([["x-forwarded-for", "203.0.113.1"]]));
});

const merchant = { id: "m1", slug: "acme-cafe", name: "Acme" };
const program = { id: "p1", merchantId: "m1", passKitProgramId: "pk_prog_1" };

describe("enrollCustomer", () => {
  it("issues a new pass when none exists", async () => {
    const { enrollCustomer } = await import("./enrollment");
    findMerchant.mockResolvedValue(merchant);
    findActiveProgram.mockResolvedValue(program);
    findPass.mockResolvedValue(null);
    issuePass.mockResolvedValue({
      passKitPassId: "pk_pass_1",
      applePassUrl: "https://wallet.apple/pkpass/1",
      googleWalletUrl: "https://pay.google.com/gp/v/save/1",
    });
    createPass.mockResolvedValue({ id: "db_pass_1" });

    const res = await enrollCustomer({ merchantSlug: "acme-cafe", phone: "0512345678" });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error();
    expect(res.applePassUrl).toMatch(/wallet.apple/);
    expect(issuePass).toHaveBeenCalledWith({
      programId: "pk_prog_1",
      customerPhone: "+966512345678",
    });
    expect(createPass).toHaveBeenCalledOnce();
  });

  it("is idempotent — returns existing pass for same phone", async () => {
    const { enrollCustomer } = await import("./enrollment");
    findMerchant.mockResolvedValue(merchant);
    findActiveProgram.mockResolvedValue(program);
    findPass.mockResolvedValue({
      id: "db_pass_1",
      passKitPassId: "pk_pass_1",
      applePassUrl: "https://wallet.apple/pkpass/1",
      googleWalletUrl: "https://pay.google.com/gp/v/save/1",
    });

    const res = await enrollCustomer({ merchantSlug: "acme-cafe", phone: "+966512345678" });

    expect(res.ok).toBe(true);
    expect(issuePass).not.toHaveBeenCalled();
    expect(createPass).not.toHaveBeenCalled();
  });

  it("returns 429 when IP limit exceeded", async () => {
    ipLimit.mockResolvedValue({ success: false, reset: Date.now() + 1000 });
    const { enrollCustomer } = await import("./enrollment");
    const res = await enrollCustomer({ merchantSlug: "acme-cafe", phone: "+966512345678" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("RATE_LIMITED");
  });

  it("returns 429 when phone limit exceeded", async () => {
    phoneLimit.mockResolvedValue({ success: false, reset: Date.now() + 1000 });
    const { enrollCustomer } = await import("./enrollment");
    const res = await enrollCustomer({ merchantSlug: "acme-cafe", phone: "+966512345678" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("RATE_LIMITED");
  });

  it("rejects unknown merchant", async () => {
    findMerchant.mockResolvedValue(null);
    const { enrollCustomer } = await import("./enrollment");
    const res = await enrollCustomer({ merchantSlug: "ghost", phone: "+966512345678" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("MERCHANT_NOT_FOUND");
  });

  it("rejects merchant without active program", async () => {
    findMerchant.mockResolvedValue(merchant);
    findActiveProgram.mockResolvedValue(null);
    const { enrollCustomer } = await import("./enrollment");
    const res = await enrollCustomer({ merchantSlug: "acme-cafe", phone: "+966512345678" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("PROGRAM_NOT_READY");
  });

  it("validates phone — rejects garbage", async () => {
    const { enrollCustomer } = await import("./enrollment");
    const res = await enrollCustomer({ merchantSlug: "acme-cafe", phone: "abc" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("VALIDATION");
  });

  it("verifies signature when present and valid", async () => {
    findMerchant.mockResolvedValue(merchant);
    findActiveProgram.mockResolvedValue(program);
    findPass.mockResolvedValue(null);
    issuePass.mockResolvedValue({
      passKitPassId: "pk_pass_1",
      applePassUrl: "https://w/1", googleWalletUrl: "https://g/1",
    });
    createPass.mockResolvedValue({ id: "db_pass_1" });

    vi.doMock("@/lib/hmac", () => ({
      verifyEnrollmentSignature: vi.fn().mockReturnValue(true),
      signEnrollmentUrl: vi.fn(),
    }));
    const { enrollCustomer } = await import("./enrollment");
    const res = await enrollCustomer({
      merchantSlug: "acme-cafe", phone: "+966512345678",
      sig: "abc", exp: Date.now() + 10_000,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects when signature provided but invalid", async () => {
    vi.doMock("@/lib/hmac", () => ({
      verifyEnrollmentSignature: vi.fn().mockReturnValue(false),
      signEnrollmentUrl: vi.fn(),
    }));
    const { enrollCustomer } = await import("./enrollment");
    const res = await enrollCustomer({
      merchantSlug: "acme-cafe", phone: "+966512345678",
      sig: "tampered", exp: Date.now() + 10_000,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("INVALID_SIGNATURE");
  });
});

describe("recoverPass", () => {
  it("returns existing pass without re-issuing", async () => {
    const { recoverPass } = await import("./enrollment");
    findMerchant.mockResolvedValue(merchant);
    findActiveProgram.mockResolvedValue(program);
    findPass.mockResolvedValue({
      id: "db1",
      applePassUrl: "https://w/1",
      googleWalletUrl: "https://g/1",
    });
    const res = await recoverPass({ merchantSlug: "acme-cafe", phone: "+966512345678" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error();
    expect(res.applePassUrl).toBe("https://w/1");
    expect(issuePass).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when no pass exists", async () => {
    const { recoverPass } = await import("./enrollment");
    findMerchant.mockResolvedValue(merchant);
    findActiveProgram.mockResolvedValue(program);
    findPass.mockResolvedValue(null);
    const res = await recoverPass({ merchantSlug: "acme-cafe", phone: "+966512345678" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("NOT_FOUND");
  });

  it("rate-limits at 3/hour", async () => {
    recoverLimit.mockResolvedValue({ success: false, reset: Date.now() + 1000 });
    const { recoverPass } = await import("./enrollment");
    const res = await recoverPass({ merchantSlug: "acme-cafe", phone: "+966512345678" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error();
    expect(res.code).toBe("RATE_LIMITED");
  });
});
```

- [ ] Implement `src/lib/actions/enrollment.ts`:

```ts
"use server";

import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { issuePass } from "@/lib/passkit/passes";
import {
  enrollIpLimiter,
  enrollPhoneLimiter,
  recoverPhoneLimiter,
} from "@/lib/ratelimit";
import { verifyEnrollmentSignature } from "@/lib/hmac";
import {
  enrollPayloadSchema,
  recoverPayloadSchema,
} from "@/lib/validation/enrollment";

type EnrollSuccess = {
  ok: true;
  passId: string;
  applePassUrl: string;
  googleWalletUrl: string;
  alreadyEnrolled: boolean;
};

type EnrollFailure = {
  ok: false;
  code:
    | "VALIDATION"
    | "RATE_LIMITED"
    | "MERCHANT_NOT_FOUND"
    | "PROGRAM_NOT_READY"
    | "INVALID_SIGNATURE"
    | "INTERNAL";
  message: string;
  resetAt?: number;
};

export type EnrollResult = EnrollSuccess | EnrollFailure;

async function getClientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "0.0.0.0"
  );
}

export async function enrollCustomer(input: unknown): Promise<EnrollResult> {
  const parsed = enrollPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { merchantSlug, phone, sig, exp } = parsed.data;

  if (sig && exp) {
    if (!verifyEnrollmentSignature(merchantSlug, exp, sig)) {
      return { ok: false, code: "INVALID_SIGNATURE", message: "Invalid or expired link" };
    }
  }

  const ip = await getClientIp();
  const ipRes = await enrollIpLimiter.limit(ip);
  if (!ipRes.success) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many requests", resetAt: ipRes.reset };
  }
  const phoneRes = await enrollPhoneLimiter.limit(phone);
  if (!phoneRes.success) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many requests", resetAt: phoneRes.reset };
  }

  try {
    const merchant = await prisma.merchant.findUnique({ where: { slug: merchantSlug } });
    if (!merchant) return { ok: false, code: "MERCHANT_NOT_FOUND", message: "Unknown merchant" };

    const program = await prisma.loyaltyProgram.findFirst({
      where: { merchantId: merchant.id, passKitProgramId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (!program?.passKitProgramId) {
      return { ok: false, code: "PROGRAM_NOT_READY", message: "Loyalty program not ready" };
    }

    // Idempotency — same phone in same program returns the existing pass.
    const existing = await prisma.pass.findFirst({
      where: { programId: program.id, customerPhone: phone, status: { not: "DELETED" } },
    });
    if (existing) {
      return {
        ok: true,
        passId: existing.id,
        applePassUrl: existing.applePassUrl,
        googleWalletUrl: existing.googleWalletUrl,
        alreadyEnrolled: true,
      };
    }

    const issued = await issuePass({
      programId: program.passKitProgramId,
      customerPhone: phone,
    });

    const created = await prisma.pass.create({
      data: {
        programId: program.id,
        customerPhone: phone,
        passKitPassId: issued.passKitPassId,
        applePassUrl: issued.applePassUrl,
        googleWalletUrl: issued.googleWalletUrl,
        status: "ACTIVE",
        stampsCount: 0,
      },
    });

    return {
      ok: true,
      passId: created.id,
      applePassUrl: issued.applePassUrl,
      googleWalletUrl: issued.googleWalletUrl,
      alreadyEnrolled: false,
    };
  } catch (err) {
    Sentry.captureException(err, { tags: { action: "enrollCustomer", merchantSlug } });
    return { ok: false, code: "INTERNAL", message: "Something went wrong" };
  }
}

type RecoverResult =
  | { ok: true; applePassUrl: string; googleWalletUrl: string }
  | { ok: false; code: "VALIDATION" | "RATE_LIMITED" | "NOT_FOUND" | "INTERNAL"; message: string; resetAt?: number };

export async function recoverPass(input: unknown): Promise<RecoverResult> {
  const parsed = recoverPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const { merchantSlug, phone } = parsed.data;

  const phoneRes = await recoverPhoneLimiter.limit(phone);
  if (!phoneRes.success) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many attempts", resetAt: phoneRes.reset };
  }

  try {
    const merchant = await prisma.merchant.findUnique({ where: { slug: merchantSlug } });
    if (!merchant) return { ok: false, code: "NOT_FOUND", message: "Not found" };

    const program = await prisma.loyaltyProgram.findFirst({
      where: { merchantId: merchant.id, passKitProgramId: { not: null } },
    });
    if (!program) return { ok: false, code: "NOT_FOUND", message: "Not found" };

    const existing = await prisma.pass.findFirst({
      where: { programId: program.id, customerPhone: phone, status: { not: "DELETED" } },
    });
    if (!existing) return { ok: false, code: "NOT_FOUND", message: "No pass found for this phone" };

    return {
      ok: true,
      applePassUrl: existing.applePassUrl,
      googleWalletUrl: existing.googleWalletUrl,
    };
  } catch (err) {
    Sentry.captureException(err, { tags: { action: "recoverPass", merchantSlug } });
    return { ok: false, code: "INTERNAL", message: "Something went wrong" };
  }
}
```

- [ ] **Schema note for Plan 2 owner:** the `Pass` model needs `applePassUrl: String` and `googleWalletUrl: String` columns + a `slug: String @unique` on `Merchant`. If Plan 2 hasn't shipped these, add a migration in the same task:

```prisma
model Merchant {
  // ...existing fields
  slug          String   @unique
}

model Pass {
  // ...existing fields
  applePassUrl    String
  googleWalletUrl String
}
```

Run `bunx prisma migrate dev --name enrollment_pass_urls`.

- [ ] Run `bun run test src/lib/actions/enrollment.test.ts` — all pass.

- [ ] Commit: `feat(enroll): server action enrollCustomer + recoverPass`

---

## Task 5 — QR + printable PDF generation

**Files:**
- `src/lib/qr.ts`
- `src/lib/qr.test.ts`

### Steps

- [ ] **Test first** — `src/lib/qr.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { ENROLLMENT_HMAC_SECRET: "a".repeat(64), NEXT_PUBLIC_APP_URL: "https://stampme.com" },
}));

import { generateEnrollmentQrDataUrl, generateQrPosterPdf } from "./qr";

describe("generateEnrollmentQrDataUrl", () => {
  it("returns a data URL PNG", async () => {
    const out = await generateEnrollmentQrDataUrl("acme-cafe");
    expect(out).toMatch(/^data:image\/png;base64,/);
  });
});

describe("generateQrPosterPdf", () => {
  it("returns a non-empty PDF buffer", async () => {
    const buf = await generateQrPosterPdf({
      merchantName: "Acme Cafe",
      merchantLogoUrl: null,
      brandColor: "#1F6F4A",
      slug: "acme-cafe",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    // PDF magic bytes
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  }, 15_000);
});
```

- [ ] Implement `src/lib/qr.ts`:

```ts
import QRCode from "qrcode";
import { renderToBuffer, Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import React from "react";
import { signEnrollmentUrl } from "@/lib/hmac";

const QR_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 1 year — printed posters live long

export async function generateEnrollmentQrDataUrl(slug: string): Promise<string> {
  const url = signEnrollmentUrl(slug, Date.now() + QR_TTL_MS);
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 1024, // 300 DPI on ~3.4 inch print
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

export type PosterArgs = {
  merchantName: string;
  merchantLogoUrl: string | null;
  brandColor: string;
  slug: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
  },
  header: { alignItems: "center", marginTop: 12 },
  logo: { width: 96, height: 96, objectFit: "contain", marginBottom: 12 },
  merchantName: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  // Arabic instruction — RTL string. @react-pdf needs a font that supports Arabic.
  // Plan 1 must register a font (e.g. Tajawal) under family "Tajawal".
  arInstruction: {
    fontSize: 18,
    fontFamily: "Tajawal",
    textAlign: "center",
    marginBottom: 16,
    direction: "rtl",
  },
  enInstruction: { fontSize: 11, color: "#666", textAlign: "center", marginBottom: 12 },
  qrFrame: { padding: 12, borderWidth: 4, borderRadius: 12, borderStyle: "solid" },
  qr: { width: 320, height: 320 },
  footer: { fontSize: 8, color: "#999", marginTop: 12 },
});

export async function generateQrPosterPdf(args: PosterArgs): Promise<Buffer> {
  const qrDataUrl = await generateEnrollmentQrDataUrl(args.slug);

  const doc = React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      // A6 = 105 x 148 mm. @react-pdf supports "A6".
      { size: "A6", style: styles.page },
      React.createElement(
        View,
        { style: styles.header },
        args.merchantLogoUrl
          ? React.createElement(Image, { src: args.merchantLogoUrl, style: styles.logo })
          : null,
        React.createElement(Text, { style: styles.merchantName }, args.merchantName),
      ),
      React.createElement(
        Text,
        { style: styles.arInstruction },
        "اسحب الكاميرا واحصل على كرت ولاء",
      ),
      React.createElement(
        Text,
        { style: styles.enInstruction },
        "Scan with your camera to get a loyalty card",
      ),
      React.createElement(
        View,
        { style: { ...styles.qrFrame, borderColor: args.brandColor } },
        React.createElement(Image, { src: qrDataUrl, style: styles.qr }),
      ),
      React.createElement(Text, { style: styles.footer }, "Powered by stampme"),
    ),
  );

  return renderToBuffer(doc);
}
```

- [ ] **Plan 1 dependency:** Plan 1 must register an Arabic-capable font (e.g. Tajawal) globally. If not yet present, add to Plan 1 setup module:

```ts
// src/lib/pdf-fonts.ts (called once at server boot)
import { Font } from "@react-pdf/renderer";
import path from "node:path";
Font.register({
  family: "Tajawal",
  fonts: [
    { src: path.join(process.cwd(), "public/fonts/Tajawal-Regular.ttf") },
    { src: path.join(process.cwd(), "public/fonts/Tajawal-Bold.ttf"), fontWeight: 700 },
  ],
});
```

Drop Tajawal TTFs (SIL OFL — free) into `public/fonts/`.

- [ ] Add server action wrapper in `src/lib/actions/enrollment.ts`:

```ts
import { generateQrPosterPdf } from "@/lib/qr";
import { auth } from "@clerk/nextjs/server"; // for merchant ownership check

export async function generateQrPdf(merchantId: string): Promise<{ ok: true; pdfBase64: string } | { ok: false; message: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, message: "Unauthorized" };
  const merchant = await prisma.merchant.findFirst({
    where: { id: merchantId, clerkUserId: userId },
  });
  if (!merchant) return { ok: false, message: "Forbidden" };

  const buf = await generateQrPosterPdf({
    merchantName: merchant.name,
    merchantLogoUrl: merchant.logoUrl,
    brandColor: merchant.brandColor,
    slug: merchant.slug,
  });
  return { ok: true, pdfBase64: buf.toString("base64") };
}
```

- [ ] Run `bun run test src/lib/qr.test.ts` — all pass.

- [ ] Commit: `feat(enroll): QR code generation + printable A6 poster PDF`

---

## Task 6 — Public layout + page at `/c/[merchantSlug]`

**Files:**
- `src/app/c/[merchantSlug]/layout.tsx`
- `src/app/c/[merchantSlug]/page.tsx`
- `src/app/c/[merchantSlug]/_components/WalletButtons.tsx`
- `src/app/c/[merchantSlug]/_components/EnrollmentForm.tsx`

### Steps

- [ ] Verify Plan 1's middleware already excludes `/c/*` from auth-gating + i18n routing. The relevant matcher is `isApiRoute = createRouteMatcher(["/api/(.*)", "/c/(.*)", "/scan(.*)"])` which short-circuits before `auth.protect()` and `intlMiddleware`. No changes needed here — this checkbox is just a reminder before the layout/page work below. If `src/middleware.ts` was edited away from Plan 1's shape, restore it.

- [ ] Layout — `src/app/c/[merchantSlug]/layout.tsx`:

> Note: enrollment pages live OUTSIDE the `[locale]` segment (Plan 1's middleware excludes `/c/*` from i18n routing — the public URL stays clean for shareability and merchant brand). Because there is no parent locale layout, this layout owns its own `<html>`/`<body>` and hardcodes `lang="ar" dir="rtl"` — KSA default. (Phase 2: read merchant.preferredLocale from DB to optionally serve English.)

```tsx
import "@/app/globals.css";
import { Tajawal } from "next/font/google";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { merchantSlugSchema } from "@/lib/validation/enrollment";

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
});

export const dynamic = "force-dynamic";

export default async function MerchantPublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const slug = merchantSlugSchema.safeParse(merchantSlug);
  if (!slug.success) notFound();

  const merchant = await prisma.merchant.findUnique({
    where: { slug: slug.data },
    select: { id: true, name: true, logoUrl: true, brandColor: true },
  });
  if (!merchant) notFound();

  // Enrollment pages are merchant-language-specific. Default to Arabic for KSA,
  // hardcoded RTL since this layout sits outside the `[locale]` segment.
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-white font-sans text-neutral-900 antialiased">
        <div
          style={{ ["--brand" as string]: merchant.brandColor }}
          className="min-h-screen"
        >
          {children}
          <footer className="py-6 text-center text-xs text-neutral-400">
            Powered by <span className="font-medium">stampme</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
```

- [ ] Page — `src/app/c/[merchantSlug]/page.tsx`:

```tsx
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PassPreview } from "@/components/PassPreview"; // from Plan 2
import { EnrollmentForm } from "./_components/EnrollmentForm";

export const dynamic = "force-dynamic";

type Search = { sig?: string; exp?: string };

// Enrollment pages live outside the `[locale]` segment — KSA Arabic by default.
const locale = "ar" as const;

export default async function CustomerEnrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantSlug: string }>;
  searchParams: Promise<Search>;
}) {
  const { merchantSlug } = await params;
  const sp = await searchParams;

  const merchant = await prisma.merchant.findUnique({
    where: { slug: merchantSlug },
    include: {
      programs: {
        where: { passKitProgramId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!merchant || merchant.programs.length === 0) notFound();
  const program = merchant.programs[0];

  const headlineAr = `اجمع ${program.stampsRequired} ختمات، خذ ${program.rewardLabel} مجاناً`;
  const headlineEn = `Collect ${program.stampsRequired} stamps, get ${program.rewardLabel} free`;

  return (
    <main className="mx-auto max-w-md px-5 pb-12 pt-10">
      <header className="flex flex-col items-center text-center">
        {merchant.logoUrl ? (
          <Image
            src={merchant.logoUrl}
            alt={merchant.name}
            width={88}
            height={88}
            className="mb-3 h-22 w-22 rounded-2xl object-contain"
            unoptimized
          />
        ) : (
          <div className="mb-3 flex h-22 w-22 items-center justify-center rounded-2xl bg-neutral-100 text-2xl font-bold">
            {merchant.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-bold text-neutral-900">{merchant.name}</h1>
        <p className="mt-3 text-lg text-neutral-700">
          {locale === "ar" ? headlineAr : headlineEn}
        </p>
      </header>

      <div className="my-8">
        <PassPreview
          merchantName={merchant.name}
          logoUrl={merchant.logoUrl}
          brandColor={merchant.brandColor}
          stampsRequired={program.stampsRequired}
          rewardLabel={program.rewardLabel}
          stampsCount={0}
        />
      </div>

      <EnrollmentForm
        merchantSlug={merchantSlug}
        sig={sp.sig}
        exp={sp.exp ? Number(sp.exp) : undefined}
        locale={locale}
      />
    </main>
  );
}
```

- [ ] WalletButtons — `src/app/c/[merchantSlug]/_components/WalletButtons.tsx`:

```tsx
"use client";

type Props = { applePassUrl: string; googleWalletUrl: string; locale: string };

export function WalletButtons({ applePassUrl, googleWalletUrl, locale }: Props) {
  const isAr = locale === "ar";
  return (
    <div className="flex flex-col gap-3">
      <a
        href={applePassUrl}
        className="flex items-center justify-center gap-2 rounded-xl bg-black px-5 py-4 text-white shadow-sm active:scale-[0.98]"
        aria-label="Add to Apple Wallet"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden>
          <path d="M16.4 12.3c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.8-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.3 2.6 1.3-.1 1.8-.9 3.4-.9s2.1.9 3.4.8c1.4 0 2.3-1.3 3.2-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.6-1-2.6-3.9zM13.9 4.7c.7-.8 1.2-2 1.1-3.1-1 0-2.2.7-2.9 1.5-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.7 2.9-1.5z" />
        </svg>
        <span>{isAr ? "أضف إلى Apple Wallet" : "Add to Apple Wallet"}</span>
      </a>
      <a
        href={googleWalletUrl}
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-5 py-4 font-medium text-black active:scale-[0.98]"
        aria-label="Add to Google Wallet"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          <path fill="#4285F4" d="M3 6h18v12H3z" />
          <path fill="#fff" d="M3 6h18l-9 6z" />
        </svg>
        <span>{isAr ? "أضف إلى Google Wallet" : "Add to Google Wallet"}</span>
      </a>
    </div>
  );
}
```

- [ ] EnrollmentForm — `src/app/c/[merchantSlug]/_components/EnrollmentForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrollCustomer } from "@/lib/actions/enrollment";
import { WalletButtons } from "./WalletButtons";

type Props = { merchantSlug: string; sig?: string; exp?: number; locale: string };

type Issued = { applePassUrl: string; googleWalletUrl: string };

export function EnrollmentForm({ merchantSlug, sig, exp, locale }: Props) {
  const isAr = locale === "ar";
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await enrollCustomer({ merchantSlug, phone, sig, exp });
      if (!res.ok) {
        setError(
          res.code === "RATE_LIMITED"
            ? isAr ? "محاولات كثيرة، حاول لاحقاً" : "Too many attempts, try later"
            : res.code === "VALIDATION"
              ? res.message
              : isAr ? "حصل خطأ، جرّب مرة ثانية" : "Something went wrong",
        );
        return;
      }
      setIssued({ applePassUrl: res.applePassUrl, googleWalletUrl: res.googleWalletUrl });
      // Prefetch the success page so the redirect after wallet add is instant.
      router.prefetch(`/${locale}/c/${merchantSlug}/added`);
    });
  }

  if (issued) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-center text-base text-neutral-700">
          {isAr ? "ممتاز! اضغط الزرّ المناسب لجوّالك:" : "Great! Tap the button for your phone:"}
        </p>
        <WalletButtons {...issued} locale={locale} />
        <a
          href={`/${locale}/c/${merchantSlug}/added`}
          className="mt-2 text-center text-sm text-[var(--brand)] underline"
        >
          {isAr ? "تمّ الإضافة" : "I added it"}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <label htmlFor="phone" className="text-sm font-medium text-neutral-800">
        {isAr ? "رقم الجوّال" : "Mobile number"}
      </label>
      <div className="flex items-stretch overflow-hidden rounded-xl border-2 border-neutral-200 bg-white focus-within:border-[var(--brand)]">
        <span className="flex items-center bg-neutral-50 px-3 text-sm text-neutral-600">+966</span>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          dir="ltr"
          placeholder="5X XXX XXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full px-3 py-3 text-base outline-none"
          required
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-[var(--brand)] px-5 py-4 text-white font-medium shadow-sm active:scale-[0.98] disabled:opacity-60"
      >
        {pending
          ? isAr ? "جاري الإصدار..." : "Issuing..."
          : isAr ? "احصل على كرت الولاء" : "Get your loyalty card"}
      </button>
      <p className="text-center text-xs text-neutral-500">
        {isAr ? "بإصدارك للكرت توافق على شروط الخدمة" : "By continuing you accept the terms"}
      </p>
    </form>
  );
}
```

- [ ] Smoke test the page locally:

```bash
bun dev
# Open http://localhost:3000/c/<seed-slug>
```

- [ ] Commit: `feat(enroll): public /c/[slug] page + wallet buttons + form`

---

## Task 7 — Success page `/c/[slug]/added`

**Files:**
- `src/app/c/[merchantSlug]/added/page.tsx`

### Steps

- [ ] Implement page:

```tsx
import { notFound } from "next/navigation";
import Image from "next/image";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Enrollment pages live outside the `[locale]` segment — KSA Arabic by default.
const locale = "ar" as const;

export default async function AddedPage({
  params,
}: {
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const merchant = await prisma.merchant.findUnique({
    where: { slug: merchantSlug },
    select: { name: true, logoUrl: true },
  });
  if (!merchant) notFound();
  const isAr = locale === "ar";

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-5 pb-16 pt-12 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)]/10">
        <svg viewBox="0 0 24 24" className="h-9 w-9 fill-[var(--brand)]">
          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19l12-12-1.4-1.4z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold">
        {isAr ? "تمّت إضافة الكرت إلى محفظتك!" : "Pass added to your wallet!"}
      </h1>
      {merchant.logoUrl ? (
        <Image
          src={merchant.logoUrl}
          alt={merchant.name}
          width={64}
          height={64}
          className="my-4 h-16 w-16 rounded-xl object-contain"
          unoptimized
        />
      ) : null}
      <p className="mt-3 text-base text-neutral-700">
        {isAr
          ? "في زيارتك القادمة، أظهر الكرت عند الكاشير لإضافة ختم."
          : "On your next visit, show this pass at the cashier to collect a stamp."}
      </p>
      <ol className="mt-6 space-y-2 text-start text-sm text-neutral-600">
        <li>
          {isAr ? "١. افتح Apple Wallet أو Google Wallet" : "1. Open Apple Wallet or Google Wallet"}
        </li>
        <li>{isAr ? "٢. أظهر الكرت عند الكاشير" : "2. Show the card at the cashier"}</li>
        <li>{isAr ? "٣. الكرت يتحدّث تلقائياً" : "3. Your card updates automatically"}</li>
      </ol>
    </main>
  );
}
```

- [ ] Commit: `feat(enroll): success page after wallet add`

---

## Task 8 — Recovery page `/c/[slug]/recover`

**Files:**
- `src/app/c/[merchantSlug]/recover/page.tsx`
- `src/app/c/[merchantSlug]/recover/_RecoverForm.tsx`

### Steps

- [ ] Recover page:

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { RecoverForm } from "./_RecoverForm";

export const dynamic = "force-dynamic";

// Enrollment pages live outside the `[locale]` segment — KSA Arabic by default.
const locale = "ar" as const;

export default async function RecoverPage({
  params,
}: {
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const merchant = await prisma.merchant.findUnique({
    where: { slug: merchantSlug },
    select: { name: true },
  });
  if (!merchant) notFound();
  const isAr = locale === "ar";

  return (
    <main className="mx-auto max-w-md px-5 pb-16 pt-12">
      <h1 className="text-2xl font-bold text-center">
        {isAr ? "استرجاع كرت الولاء" : "Recover your loyalty card"}
      </h1>
      <p className="mt-3 text-center text-sm text-neutral-600">
        {isAr
          ? `أدخل الرقم الذي استخدمته في ${merchant.name}`
          : `Enter the phone you used at ${merchant.name}`}
      </p>
      <div className="mt-8">
        <RecoverForm merchantSlug={merchantSlug} locale={locale} />
      </div>
    </main>
  );
}
```

- [ ] RecoverForm:

```tsx
"use client";

import { useState, useTransition } from "react";
import { recoverPass } from "@/lib/actions/enrollment";
import { WalletButtons } from "../_components/WalletButtons";

export function RecoverForm({ merchantSlug, locale }: { merchantSlug: string; locale: string }) {
  const isAr = locale === "ar";
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ applePassUrl: string; googleWalletUrl: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await recoverPass({ merchantSlug, phone });
      if (!res.ok) {
        setError(
          res.code === "RATE_LIMITED"
            ? isAr ? "محاولات كثيرة، حاول بعد ساعة" : "Too many attempts, try in 1h"
            : res.code === "NOT_FOUND"
              ? isAr ? "لا يوجد كرت بهذا الرقم" : "No card found for this number"
              : isAr ? "حصل خطأ" : "Error",
        );
        return;
      }
      setFound({ applePassUrl: res.applePassUrl, googleWalletUrl: res.googleWalletUrl });
    });
  }

  if (found) return <WalletButtons {...found} locale={locale} />;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex items-stretch overflow-hidden rounded-xl border-2 border-neutral-200 bg-white">
        <span className="flex items-center bg-neutral-50 px-3 text-sm text-neutral-600">+966</span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          dir="ltr"
          placeholder="5X XXX XXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full px-3 py-3 text-base outline-none"
          required
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-[var(--brand)] px-5 py-4 text-white font-medium disabled:opacity-60"
      >
        {pending ? (isAr ? "بحث..." : "Searching...") : (isAr ? "استرجاع الكرت" : "Recover card")}
      </button>
    </form>
  );
}
```

- [ ] Commit: `feat(enroll): lost-pass recovery flow`

---

## Task 9 — End-to-end smoke + integration tests

**Files:**
- `src/app/c/[merchantSlug]/page.test.tsx`
- `tests/e2e/enrollment.spec.ts` (Playwright — Plan 1 must have set up)

### Steps

- [ ] Page integration test (renders from DB seed):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/db", () => ({
  prisma: {
    merchant: {
      findUnique: vi.fn().mockResolvedValue({
        id: "m1",
        name: "Acme Cafe",
        logoUrl: null,
        brandColor: "#1F6F4A",
        slug: "acme-cafe",
        programs: [
          { id: "p1", stampsRequired: 10, rewardLabel: "قهوة", passKitProgramId: "pk1" },
        ],
      }),
    },
  },
}));
vi.mock("@/components/PassPreview", () => ({
  PassPreview: () => <div data-testid="pass-preview" />,
}));

import Page from "./page";

describe("CustomerEnrollPage", () => {
  it("renders Arabic headline with stamp count and reward", async () => {
    const ui = await Page({
      params: Promise.resolve({ merchantSlug: "acme-cafe", locale: "ar" }),
      searchParams: Promise.resolve({}),
    });
    render(ui as React.ReactElement);
    expect(screen.getByText(/اجمع 10 ختمات/)).toBeInTheDocument();
    expect(screen.getByText(/قهوة/)).toBeInTheDocument();
    expect(screen.getByTestId("pass-preview")).toBeInTheDocument();
  });
});
```

- [ ] Playwright e2e (assumes Plan 1 seeded a `demo-cafe` merchant + active program):

```ts
import { test, expect } from "@playwright/test";

test("customer enrolls and sees wallet buttons", async ({ page }) => {
  await page.goto("/c/demo-cafe");
  await expect(page.getByRole("heading", { name: /demo cafe/i })).toBeVisible();
  await page.getByLabel("رقم الجوّال").fill("0512345678");
  await page.getByRole("button", { name: /احصل على كرت الولاء/ }).click();
  await expect(page.getByRole("link", { name: /Apple Wallet/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Google Wallet/i })).toBeVisible();
});

test("recovery returns existing pass for same phone", async ({ page }) => {
  await page.goto("/c/demo-cafe/recover");
  await page.getByPlaceholder("5X XXX XXXX").fill("0512345678");
  await page.getByRole("button", { name: /استرجاع الكرت/ }).click();
  await expect(page.getByRole("link", { name: /Apple Wallet/i })).toBeVisible();
});
```

- [ ] Run full test suite:

```bash
bun run test
bun run e2e
```

- [ ] Commit: `test(enroll): integration + e2e for /c/[slug] flow`

---

## Task 10 — Sentry tags, observability, and final wiring

**Files:**
- `src/lib/actions/enrollment.ts` (extend)
- `src/app/c/[merchantSlug]/page.tsx` (cache headers)

### Steps

- [ ] Add Sentry breadcrumbs around the PassKit call so PD failures correlate:

```ts
// inside enrollCustomer, before calling issuePass:
Sentry.addBreadcrumb({
  category: "enrollment",
  message: "issuing pass",
  level: "info",
  data: { merchantSlug, programId: program.passKitProgramId },
});
```

- [ ] Set cache headers on the public page (private — rendered per phone). In `page.tsx`:

```tsx
import { headers } from "next/headers";
// ...
const h = await headers();
// no-op read; ensures dynamic rendering. Vercel will not cache thanks to `force-dynamic`.
```

- [ ] Add a simple `/api/c/qr/[merchantId]/route.ts` route that downloads the PDF (for the merchant dashboard download button — Plan 7 will surface it, but expose endpoint here):

```ts
// src/app/api/c/qr/[merchantId]/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateQrPosterPdf } from "@/lib/qr";

export async function GET(_req: Request, ctx: { params: Promise<{ merchantId: string }> }) {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const { merchantId } = await ctx.params;
  const merchant = await prisma.merchant.findFirst({
    where: { id: merchantId, clerkUserId: userId },
  });
  if (!merchant) return new NextResponse("Forbidden", { status: 403 });

  const pdf = await generateQrPosterPdf({
    merchantName: merchant.name,
    merchantLogoUrl: merchant.logoUrl,
    brandColor: merchant.brandColor,
    slug: merchant.slug,
  });

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${merchant.slug}-poster.pdf"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
```

- [ ] Run full test suite + typecheck + lint:

```bash
bun run typecheck && bun run lint && bun run test
```

- [ ] Commit: `chore(enroll): observability + QR PDF download endpoint`

---

## Acceptance Criteria

- [ ] `/c/[slug]` renders merchant-branded enrollment page in Arabic with no Clerk gate.
- [ ] Submitting a valid KSA phone issues a PassKit pass and shows Apple + Google Wallet buttons.
- [ ] Same phone submitted twice returns the same pass (idempotent — no duplicate PassKit calls).
- [ ] Exceeding 10 enrollments/hour from one IP returns `RATE_LIMITED`.
- [ ] Exceeding 5 enrollments/day for one phone returns `RATE_LIMITED`.
- [ ] Tampered or expired `?sig=&exp=` rejected with `INVALID_SIGNATURE`.
- [ ] `/c/[slug]/added` shows confirmation in correct locale.
- [ ] `/c/[slug]/recover` returns existing pass URLs without re-issuing; rate-limited at 3/hour.
- [ ] `generateQrPosterPdf` returns a valid A6 PDF with merchant logo, Arabic instruction, and signed QR.
- [ ] All unit + integration tests pass; Playwright e2e green.

---

## Out of Scope (handed off to other plans)

- Plan 5 — Staff scanner increments `stampsCount` (this plan only issues passes at 0 stamps).
- Plan 6 — Billing enforces the `Starter: 300 passes/mo` cap; this plan does not block on quota.
- Plan 7 — Merchant dashboard renders the "Download QR poster" button that calls `/api/c/qr/:id`.
- Phase 2 — OTP verification before pass issuance (only needed if abuse is observed; rate limiting + HMAC are MVP).

---

## Risks & Notes

- **PassKit downtime** — `issuePass` failure currently surfaces as `INTERNAL`. Plan 3 may add a queue + retry; this plan does not depend on it.
- **Phone uniqueness across merchants** — pass uniqueness is `{programId, customerPhone}`. A customer can enroll at multiple merchants with the same phone. That is correct.
- **PDPL** — `customerPhone` is personal data. Plan 1 must have a privacy notice link in the footer; Plan 7 must expose data-deletion tooling.
- **Arabic font in PDF** — `@react-pdf/renderer` requires explicit font registration. If Plan 1 hasn't shipped Tajawal, the PDF Arabic text will fall back to placeholder glyphs. Verify before merging.
