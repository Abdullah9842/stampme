# stampme — Plan 2: Merchant Onboarding & Card Designer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchant signs up via Clerk → completes 3-step onboarding (business profile, logo, brand color) → designs first stamp card → settings page for ongoing edits + staff PIN. All persisted to Postgres. PassKit integration deferred to Plan 3.

**Architecture:** Server-side rendered React with Server Actions for mutations. R2 for logo storage. Argon2 for PIN hashing. Slug-based merchant identification for public URLs.

**Tech Stack:** Next.js 15 Server Actions, Prisma, R2 (S3 SDK), Zod, slugify, argon2

**Depends on:** Plan 1 (Foundation) — assumes git/Next.js/Prisma/Clerk/i18n/R2 client/landing all in place.

**Spec reference:** `docs/superpowers/specs/2026-04-28-stampme-design.md`

---

## Task 1: Install Dependencies & Add Env Vars

**Files:**
- `package.json`
- `.env.example`
- `.env.local`

- [ ] Install runtime deps:
```bash
bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner slugify argon2 nanoid
bun add react-hook-form @hookform/resolvers
```

- [ ] Install dev deps:
```bash
bun add -D @types/node vitest @vitest/ui happy-dom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] Append R2 env vars to `.env.example`:
```bash
# Cloudflare R2 (logo uploads)
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET="stampme-uploads"
R2_PUBLIC_URL="https://cdn.stampme.com"
```

- [ ] Mirror the same keys in `.env.local` (with real dev values from R2 dashboard).

- [ ] Add `vitest.config.ts` at repo root:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "src/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] Add `vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Stub server-only and next/headers in test env
vi.mock("server-only", () => ({}));
```

- [ ] Add npm scripts to `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

- [ ] Verify install:
```bash
bun run test --reporter=basic
```
(Expect "no test files found" — that's fine.)

- [ ] Commit:
```bash
git add package.json bun.lockb vitest.config.ts vitest.setup.ts .env.example
git commit -m "chore: add r2/argon2/slugify deps + vitest harness for plan 2"
```

---

## Task 2: Slug Utility (TDD)

**Files:**
- `src/lib/__tests__/slug.test.ts`
- `src/lib/slug.ts`

- [ ] Write failing test `src/lib/__tests__/slug.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateMerchantSlug, ensureUniqueSlug } from "@/lib/slug";

describe("generateMerchantSlug", () => {
  it("lowercases and hyphenates basic English", () => {
    expect(generateMerchantSlug("My Coffee Shop")).toBe("my-coffee-shop");
  });

  it("strips punctuation and emojis", () => {
    expect(generateMerchantSlug("Café! ☕ Riyadh")).toBe("cafe-riyadh");
  });

  it("transliterates Arabic to latin-friendly slug", () => {
    const slug = generateMerchantSlug("قهوة الرياض");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeGreaterThan(0);
  });

  it("falls back to 'merchant' when input is unsluggable", () => {
    expect(generateMerchantSlug("!!!")).toBe("merchant");
    expect(generateMerchantSlug("")).toBe("merchant");
  });

  it("truncates to 48 chars", () => {
    const long = "a".repeat(100);
    expect(generateMerchantSlug(long).length).toBeLessThanOrEqual(48);
  });
});

describe("ensureUniqueSlug", () => {
  it("returns base slug if unused", async () => {
    const result = await ensureUniqueSlug("my-cafe", async () => false);
    expect(result).toBe("my-cafe");
  });

  it("appends -2, -3, ... until unique", async () => {
    const taken = new Set(["my-cafe", "my-cafe-2"]);
    const result = await ensureUniqueSlug("my-cafe", async (s) => taken.has(s));
    expect(result).toBe("my-cafe-3");
  });

  it("gives up after 50 attempts and appends nanoid suffix", async () => {
    const result = await ensureUniqueSlug("popular", async () => true);
    expect(result).toMatch(/^popular-[a-z0-9]{6}$/);
  });
});
```

- [ ] Run test to confirm it fails:
```bash
bun run test src/lib/__tests__/slug.test.ts
```

- [ ] Implement `src/lib/slug.ts`:
```ts
import slugify from "slugify";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 6);

export function generateMerchantSlug(input: string): string {
  if (!input?.trim()) return "merchant";

  const slug = slugify(input, {
    lower: true,
    strict: true,
    locale: "ar",
    trim: true,
  })
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return slug || "merchant";
}

export type SlugExistsCheck = (slug: string) => Promise<boolean>;

export async function ensureUniqueSlug(
  base: string,
  exists: SlugExistsCheck,
): Promise<string> {
  if (!(await exists(base))) return base;

  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }

  return `${base}-${nanoid()}`;
}
```

- [ ] Run test to confirm pass:
```bash
bun run test src/lib/__tests__/slug.test.ts
```

- [ ] Commit:
```bash
git add src/lib/slug.ts src/lib/__tests__/slug.test.ts
git commit -m "feat(slug): merchant slug generator with collision fallback"
```

---

## Task 3: PIN Hashing Utility (TDD)

**Files:**
- `src/lib/__tests__/pin.test.ts`
- `src/lib/pin.ts`

- [ ] Write failing test `src/lib/__tests__/pin.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, isValidPinFormat } from "@/lib/pin";

describe("isValidPinFormat", () => {
  it("accepts exactly 4 digits", () => {
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("0000")).toBe(true);
  });

  it("rejects non-digit chars", () => {
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("12 4")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("12345")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
  });
});

describe("hashPin / verifyPin", () => {
  it("produces argon2 hash that verifies correctly", async () => {
    const hash = await hashPin("1234");
    expect(hash).toMatch(/^\$argon2/);
    expect(await verifyPin("1234", hash)).toBe(true);
  });

  it("rejects wrong PIN", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPin("9999", hash)).toBe(false);
  });

  it("hashes are non-deterministic (salted)", async () => {
    const a = await hashPin("1234");
    const b = await hashPin("1234");
    expect(a).not.toBe(b);
  });

  it("throws on invalid PIN format at hash time", async () => {
    await expect(hashPin("abc")).rejects.toThrow(/4 digits/);
  });
});
```

- [ ] Run test to confirm fail:
```bash
bun run test src/lib/__tests__/pin.test.ts
```

- [ ] Implement `src/lib/pin.ts`:
```ts
import argon2 from "argon2";

const PIN_REGEX = /^\d{4}$/;

export function isValidPinFormat(pin: string): boolean {
  return PIN_REGEX.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN must be exactly 4 digits");
  }
  return argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}
```

- [ ] Run test to confirm pass:
```bash
bun run test src/lib/__tests__/pin.test.ts
```

- [ ] Commit:
```bash
git add src/lib/pin.ts src/lib/__tests__/pin.test.ts
git commit -m "feat(pin): argon2id pin hashing with format validation"
```

---

## Task 4: Zod Validation Schemas (TDD)

**Files:**
- `src/lib/validation/__tests__/merchant.test.ts`
- `src/lib/validation/merchant.ts`
- `src/lib/validation/__tests__/card.test.ts`
- `src/lib/validation/card.ts`

- [ ] Write `src/lib/validation/__tests__/merchant.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  onboardingStep1Schema,
  onboardingStep2Schema,
  finishOnboardingSchema,
  updateMerchantSchema,
  setStaffPinSchema,
} from "@/lib/validation/merchant";

describe("onboardingStep1Schema", () => {
  it("requires business name 2-80 chars", () => {
    expect(onboardingStep1Schema.safeParse({ name: "", vertical: "CAFE" }).success).toBe(false);
    expect(onboardingStep1Schema.safeParse({ name: "a", vertical: "CAFE" }).success).toBe(false);
    expect(onboardingStep1Schema.safeParse({ name: "ab", vertical: "CAFE" }).success).toBe(true);
    expect(onboardingStep1Schema.safeParse({ name: "x".repeat(81), vertical: "CAFE" }).success).toBe(false);
  });

  it("requires valid vertical enum", () => {
    expect(onboardingStep1Schema.safeParse({ name: "Cafe", vertical: "RESTAURANT" }).success).toBe(false);
    for (const v of ["CAFE", "SALON", "JUICE", "BAKERY", "LAUNDRY", "OTHER"]) {
      expect(onboardingStep1Schema.safeParse({ name: "Cafe", vertical: v }).success).toBe(true);
    }
  });
});

describe("onboardingStep2Schema", () => {
  it("requires hex color #RRGGBB", () => {
    expect(onboardingStep2Schema.safeParse({ logoUrl: "https://x/y.png", brandColor: "#000000" }).success).toBe(true);
    expect(onboardingStep2Schema.safeParse({ logoUrl: "https://x/y.png", brandColor: "red" }).success).toBe(false);
    expect(onboardingStep2Schema.safeParse({ logoUrl: "https://x/y.png", brandColor: "#FFF" }).success).toBe(false);
  });

  it("logoUrl is optional but must be a URL when provided", () => {
    expect(onboardingStep2Schema.safeParse({ brandColor: "#abcdef" }).success).toBe(true);
    expect(onboardingStep2Schema.safeParse({ logoUrl: "not-a-url", brandColor: "#abcdef" }).success).toBe(false);
  });
});

describe("finishOnboardingSchema", () => {
  it("merges all 3 steps", () => {
    const ok = finishOnboardingSchema.safeParse({
      name: "Cafe",
      vertical: "CAFE",
      logoUrl: "https://cdn/x.png",
      brandColor: "#112233",
    });
    expect(ok.success).toBe(true);
  });
});

describe("setStaffPinSchema", () => {
  it("requires 4-digit pin and matching confirm", () => {
    expect(setStaffPinSchema.safeParse({ pin: "1234", confirmPin: "1234" }).success).toBe(true);
    expect(setStaffPinSchema.safeParse({ pin: "1234", confirmPin: "9999" }).success).toBe(false);
    expect(setStaffPinSchema.safeParse({ pin: "abcd", confirmPin: "abcd" }).success).toBe(false);
  });
});

describe("updateMerchantSchema", () => {
  it("all fields optional, but at least one required", () => {
    expect(updateMerchantSchema.safeParse({}).success).toBe(false);
    expect(updateMerchantSchema.safeParse({ name: "New" }).success).toBe(true);
    expect(updateMerchantSchema.safeParse({ brandColor: "#ffffff" }).success).toBe(true);
  });
});
```

- [ ] Run to confirm fail:
```bash
bun run test src/lib/validation/__tests__/merchant.test.ts
```

- [ ] Implement `src/lib/validation/merchant.ts`:
```ts
import { z } from "zod";

export const VERTICALS = ["CAFE", "SALON", "JUICE", "BAKERY", "LAUNDRY", "OTHER"] as const;
export const verticalSchema = z.enum(VERTICALS);
export type Vertical = z.infer<typeof verticalSchema>;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Brand color must be a 6-digit hex like #1A2B3C");

export const onboardingStep1Schema = z.object({
  name: z.string().trim().min(2, "Business name must be at least 2 characters").max(80),
  vertical: verticalSchema,
});

export const onboardingStep2Schema = z.object({
  logoUrl: z.string().url().optional(),
  brandColor: hexColor,
});

export const onboardingStep3Schema = z.object({
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the terms" }),
  }),
});

export const finishOnboardingSchema = onboardingStep1Schema
  .merge(onboardingStep2Schema)
  .extend({
    acceptedTerms: z.boolean().optional(),
  });

export const updateMerchantSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    vertical: verticalSchema.optional(),
    logoUrl: z.string().url().optional(),
    brandColor: hexColor.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

export const setStaffPinSchema = z
  .object({
    pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
    confirmPin: z.string(),
  })
  .refine((d) => d.pin === d.confirmPin, {
    message: "PINs do not match",
    path: ["confirmPin"],
  });

export type OnboardingStep1 = z.infer<typeof onboardingStep1Schema>;
export type OnboardingStep2 = z.infer<typeof onboardingStep2Schema>;
export type FinishOnboardingInput = z.infer<typeof finishOnboardingSchema>;
export type UpdateMerchantInput = z.infer<typeof updateMerchantSchema>;
export type SetStaffPinInput = z.infer<typeof setStaffPinSchema>;
```

- [ ] Run merchant test to confirm pass:
```bash
bun run test src/lib/validation/__tests__/merchant.test.ts
```

- [ ] Write `src/lib/validation/__tests__/card.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createCardSchema, updateCardSchema } from "@/lib/validation/card";

describe("createCardSchema", () => {
  const valid = {
    programName: "Coffee Lovers",
    stampsRequired: 10,
    rewardLabel: "Free coffee",
  };

  it("accepts a valid payload", () => {
    expect(createCardSchema.safeParse(valid).success).toBe(true);
  });

  it("requires program name 2-60 chars", () => {
    expect(createCardSchema.safeParse({ ...valid, programName: "" }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, programName: "a" }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, programName: "x".repeat(61) }).success).toBe(false);
  });

  it("constrains stampsRequired to 5..20 inclusive", () => {
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 4 }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 5 }).success).toBe(true);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 20 }).success).toBe(true);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 21 }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, stampsRequired: 10.5 }).success).toBe(false);
  });

  it("caps reward label at 50 chars", () => {
    expect(createCardSchema.safeParse({ ...valid, rewardLabel: "x".repeat(50) }).success).toBe(true);
    expect(createCardSchema.safeParse({ ...valid, rewardLabel: "x".repeat(51) }).success).toBe(false);
    expect(createCardSchema.safeParse({ ...valid, rewardLabel: "" }).success).toBe(false);
  });
});

describe("updateCardSchema", () => {
  it("requires id and at least one field", () => {
    expect(updateCardSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(updateCardSchema.safeParse({ id: "abc", programName: "New" }).success).toBe(true);
  });
});
```

- [ ] Run to confirm fail:
```bash
bun run test src/lib/validation/__tests__/card.test.ts
```

- [ ] Implement `src/lib/validation/card.ts`:
```ts
import { z } from "zod";

export const createCardSchema = z.object({
  programName: z.string().trim().min(2, "Program name is required").max(60),
  stampsRequired: z
    .number()
    .int("Stamps required must be a whole number")
    .min(5, "Minimum 5 stamps")
    .max(20, "Maximum 20 stamps"),
  rewardLabel: z
    .string()
    .trim()
    .min(1, "Reward label is required")
    .max(50, "Reward label must be 50 characters or fewer"),
});

export const updateCardSchema = z
  .object({
    id: z.string().min(1),
    programName: z.string().trim().min(2).max(60).optional(),
    stampsRequired: z.number().int().min(5).max(20).optional(),
    rewardLabel: z.string().trim().min(1).max(50).optional(),
  })
  .refine(
    (d) => Object.keys(d).filter((k) => k !== "id").length > 0,
    { message: "At least one field is required" },
  );

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
```

- [ ] Run to confirm pass:
```bash
bun run test src/lib/validation/__tests__/card.test.ts
```

- [ ] Commit:
```bash
git add src/lib/validation
git commit -m "feat(validation): zod schemas for onboarding, merchant, card, staff pin"
```

---

## Task 5: R2 Upload Server Action (TDD with Mock)

**Files:**
- `src/lib/actions/__tests__/upload.test.ts`
- `src/lib/actions/upload.ts`
- `src/lib/auth/current-merchant.ts`

- [ ] Write `src/lib/auth/current-merchant.ts` (helper that resolves Clerk userId → Merchant; will be reused by every server action). Keep it thin:
```ts
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export async function getClerkUserIdOrThrow(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return userId;
}

/**
 * Returns the Merchant for the current Clerk user, or null if onboarding not done yet.
 */
export async function getCurrentMerchant() {
  const userId = await getClerkUserIdOrThrow();
  return prisma.merchant.findUnique({ where: { clerkUserId: userId } });
}

/**
 * Loads the merchant or redirects to /onboarding when missing.
 * Use this in protected merchant pages (NOT during onboarding itself).
 */
export async function requireMerchant() {
  const m = await getCurrentMerchant();
  if (!m) redirect("/onboarding");
  return m;
}
```

- [ ] Write `src/lib/actions/__tests__/upload.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_123"),
}));

vi.mock("@/lib/r2", () => ({
  r2Client: { send: sendMock },
  R2_BUCKET: "test-bucket",
  R2_PUBLIC_URL: "https://cdn.test",
}));

import { uploadLogo } from "@/lib/actions/upload";

describe("uploadLogo", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  function makeFormData(file: File, merchantId = "m_abc") {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("merchantId", merchantId);
    return fd;
  }

  it("rejects non-image mime types", async () => {
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/file type/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects files larger than 2MB", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(big));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/2MB/);
  });

  it("uploads PNG and returns CDN URL", async () => {
    const file = new File([new Uint8Array(1024)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toMatch(/^https:\/\/cdn\.test\/merchants\/m_abc\/logo\.png$/);
    }
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("preserves SVG extension", async () => {
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toMatch(/\.svg$/);
  });

  it("returns ok=false if S3 throws", async () => {
    sendMock.mockRejectedValueOnce(new Error("R2 down"));
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" });
    const result = await uploadLogo(makeFormData(file));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/upload failed/i);
  });
});
```

- [ ] Run to confirm fail:
```bash
bun run test src/lib/actions/__tests__/upload.test.ts
```

- [ ] Implement `src/lib/actions/upload.ts`:
```ts
"use server";

import "server-only";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
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
    await r2Client.send(
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
```

- [ ] Run to confirm pass:
```bash
bun run test src/lib/actions/__tests__/upload.test.ts
```

- [ ] Commit:
```bash
git add src/lib/actions/upload.ts src/lib/actions/__tests__/upload.test.ts src/lib/auth/current-merchant.ts
git commit -m "feat(upload): r2 logo upload server action with size+mime validation"
```

---

## Task 6: Onboarding Server Action (TDD)

**Files:**
- `src/lib/actions/__tests__/onboarding.test.ts`
- `src/lib/actions/onboarding.ts`

- [ ] Write `src/lib/actions/__tests__/onboarding.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const upsert = vi.fn();
const findFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    merchant: { findUnique, upsert, findFirst },
  },
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_42"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { finishOnboarding } from "@/lib/actions/onboarding";

describe("finishOnboarding", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    findFirst.mockReset();
    findFirst.mockResolvedValue(null); // slug never taken by default
  });

  it("returns validation error on bad input", async () => {
    const result = await finishOnboarding({
      name: "",
      vertical: "CAFE",
      brandColor: "#000000",
    } as any);
    expect(result.ok).toBe(false);
  });

  it("creates merchant with generated slug", async () => {
    upsert.mockResolvedValue({ id: "m_1", slug: "my-cafe" });
    const result = await finishOnboarding({
      name: "My Cafe",
      vertical: "CAFE",
      brandColor: "#112233",
      logoUrl: "https://cdn/x.png",
    });
    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clerkUserId: "user_42" },
        create: expect.objectContaining({
          name: "My Cafe",
          vertical: "CAFE",
          slug: "my-cafe",
          brandColor: "#112233",
          logoUrl: "https://cdn/x.png",
          clerkUserId: "user_42",
        }),
      }),
    );
  });

  it("appends suffix when slug is taken", async () => {
    findFirst.mockResolvedValueOnce({ id: "other" }); // 'my-cafe' taken
    findFirst.mockResolvedValueOnce(null); // 'my-cafe-2' free
    upsert.mockResolvedValue({ id: "m_2", slug: "my-cafe-2" });
    await finishOnboarding({
      name: "My Cafe",
      vertical: "CAFE",
      brandColor: "#112233",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ slug: "my-cafe-2" }),
      }),
    );
  });

  it("preserves slug on update if merchant already exists", async () => {
    findUnique.mockResolvedValueOnce({ id: "m_existing", slug: "existing-slug" });
    upsert.mockResolvedValue({ id: "m_existing", slug: "existing-slug" });
    await finishOnboarding({
      name: "Renamed Cafe",
      vertical: "CAFE",
      brandColor: "#aabbcc",
    });
    const callArg = upsert.mock.calls[0][0];
    // slug should NOT be in the update payload
    expect(callArg.update).not.toHaveProperty("slug");
    expect(callArg.update.name).toBe("Renamed Cafe");
  });
});
```

- [ ] Run to confirm fail:
```bash
bun run test src/lib/actions/__tests__/onboarding.test.ts
```

- [ ] Implement `src/lib/actions/onboarding.ts`:
```ts
"use server";

import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getClerkUserIdOrThrow } from "@/lib/auth/current-merchant";
import {
  finishOnboardingSchema,
  type FinishOnboardingInput,
} from "@/lib/validation/merchant";
import { generateMerchantSlug, ensureUniqueSlug } from "@/lib/slug";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function finishOnboarding(
  input: FinishOnboardingInput,
): Promise<ActionResult<{ merchantId: string; slug: string }>> {
  const userId = await getClerkUserIdOrThrow();

  const parsed = finishOnboardingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid onboarding payload",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const existing = await prisma.merchant.findUnique({
    where: { clerkUserId: userId },
  });

  let slug = existing?.slug;
  if (!slug) {
    const base = generateMerchantSlug(parsed.data.name);
    slug = await ensureUniqueSlug(base, async (candidate) => {
      const found = await prisma.merchant.findFirst({
        where: { slug: candidate },
        select: { id: true },
      });
      return Boolean(found);
    });
  }

  const merchant = await prisma.merchant.upsert({
    where: { clerkUserId: userId },
    create: {
      clerkUserId: userId,
      name: parsed.data.name,
      vertical: parsed.data.vertical,
      brandColor: parsed.data.brandColor,
      logoUrl: parsed.data.logoUrl ?? null,
      slug,
      ownerEmail: "", // Plan 1 may have populated this on signup; leave empty if unknown
      ownerPhone: "",
    },
    update: {
      name: parsed.data.name,
      vertical: parsed.data.vertical,
      brandColor: parsed.data.brandColor,
      logoUrl: parsed.data.logoUrl ?? null,
    },
  });

  revalidatePath("/", "layout");
  return { ok: true, data: { merchantId: merchant.id, slug: merchant.slug } };
}

export async function finishOnboardingAndRedirect(
  input: FinishOnboardingInput,
): Promise<never | ActionResult> {
  const result = await finishOnboarding(input);
  if (!result.ok) return result;
  redirect("/cards/new");
}
```

- [ ] Run to confirm pass:
```bash
bun run test src/lib/actions/__tests__/onboarding.test.ts
```

- [ ] Commit:
```bash
git add src/lib/actions/onboarding.ts src/lib/actions/__tests__/onboarding.test.ts
git commit -m "feat(onboarding): finishOnboarding server action with slug uniqueness"
```

---

## Task 7: Card CRUD Server Actions (TDD)

**Files:**
- `src/lib/actions/__tests__/cards.test.ts`
- `src/lib/actions/cards.ts`

- [ ] Write `src/lib/actions/__tests__/cards.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const programCreate = vi.fn();
const programUpdate = vi.fn();
const programFindFirst = vi.fn();
const programFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    loyaltyProgram: {
      create: programCreate,
      update: programUpdate,
      findFirst: programFindFirst,
      findMany: programFindMany,
    },
  },
}));

const requireMerchant = vi.fn();
vi.mock("@/lib/auth/current-merchant", () => ({
  requireMerchant: () => requireMerchant(),
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_x"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createCard, updateCard, listCards } from "@/lib/actions/cards";

describe("createCard", () => {
  beforeEach(() => {
    programCreate.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("rejects invalid input", async () => {
    const r = await createCard({ programName: "", stampsRequired: 10, rewardLabel: "x" });
    expect(r.ok).toBe(false);
  });

  it("creates a program with passKitProgramId=null", async () => {
    programCreate.mockResolvedValue({ id: "p_1" });
    const r = await createCard({
      programName: "Loyalty",
      stampsRequired: 10,
      rewardLabel: "Free",
    });
    expect(r.ok).toBe(true);
    expect(programCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "m_1",
        name: "Loyalty",
        stampsRequired: 10,
        rewardLabel: "Free",
        passKitProgramId: null,
      }),
    });
  });
});

describe("updateCard", () => {
  beforeEach(() => {
    programUpdate.mockReset();
    programFindFirst.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("404s when program belongs to another merchant", async () => {
    programFindFirst.mockResolvedValue(null);
    const r = await updateCard({ id: "p_other", programName: "Hi" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it("updates only provided fields", async () => {
    programFindFirst.mockResolvedValue({ id: "p_1", merchantId: "m_1" });
    programUpdate.mockResolvedValue({ id: "p_1" });
    const r = await updateCard({ id: "p_1", stampsRequired: 12 });
    expect(r.ok).toBe(true);
    expect(programUpdate).toHaveBeenCalledWith({
      where: { id: "p_1" },
      data: { stampsRequired: 12 },
    });
  });
});

describe("listCards", () => {
  beforeEach(() => {
    programFindMany.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("returns merchant's cards", async () => {
    programFindMany.mockResolvedValue([{ id: "p_1" }]);
    const r = await listCards();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toHaveLength(1);
    expect(programFindMany).toHaveBeenCalledWith({
      where: { merchantId: "m_1" },
      orderBy: { createdAt: "desc" },
    });
  });
});
```

- [ ] Run to confirm fail:
```bash
bun run test src/lib/actions/__tests__/cards.test.ts
```

- [ ] Implement `src/lib/actions/cards.ts`:
```ts
"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/auth/current-merchant";
import {
  createCardSchema,
  updateCardSchema,
  type CreateCardInput,
  type UpdateCardInput,
} from "@/lib/validation/card";
import type { ActionResult } from "@/lib/actions/onboarding";

export async function createCard(
  input: CreateCardInput,
): Promise<ActionResult<{ id: string }>> {
  const merchant = await requireMerchant();
  const parsed = createCardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid card payload",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const program = await prisma.loyaltyProgram.create({
    data: {
      merchantId: merchant.id,
      name: parsed.data.programName,
      stampsRequired: parsed.data.stampsRequired,
      rewardLabel: parsed.data.rewardLabel,
      passKitProgramId: null, // Plan 3 will populate via PassKit API
    },
  });

  revalidatePath("/cards");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: program.id } };
}

export async function updateCard(
  input: UpdateCardInput,
): Promise<ActionResult<{ id: string }>> {
  const merchant = await requireMerchant();
  const parsed = updateCardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid card payload",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const owned = await prisma.loyaltyProgram.findFirst({
    where: { id: parsed.data.id, merchantId: merchant.id },
    select: { id: true, merchantId: true },
  });
  if (!owned) return { ok: false, error: "Card not found" };

  const { id, ...rest } = parsed.data;
  const data: Record<string, unknown> = {};
  if (rest.programName !== undefined) data.name = rest.programName;
  if (rest.stampsRequired !== undefined) data.stampsRequired = rest.stampsRequired;
  if (rest.rewardLabel !== undefined) data.rewardLabel = rest.rewardLabel;

  const updated = await prisma.loyaltyProgram.update({
    where: { id },
    data,
  });

  revalidatePath(`/cards/${id}/edit`);
  revalidatePath("/cards");
  return { ok: true, data: { id: updated.id } };
}

export async function listCards(): Promise<
  ActionResult<Array<{
    id: string;
    name: string;
    stampsRequired: number;
    rewardLabel: string;
    passKitProgramId: string | null;
    createdAt: Date;
  }>>
> {
  const merchant = await requireMerchant();
  const programs = await prisma.loyaltyProgram.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
  });
  return {
    ok: true,
    data: programs.map((p) => ({
      id: p.id,
      name: p.name,
      stampsRequired: p.stampsRequired,
      rewardLabel: p.rewardLabel,
      passKitProgramId: p.passKitProgramId,
      createdAt: p.createdAt,
    })),
  };
}
```

- [ ] Run to confirm pass:
```bash
bun run test src/lib/actions/__tests__/cards.test.ts
```

- [ ] Commit:
```bash
git add src/lib/actions/cards.ts src/lib/actions/__tests__/cards.test.ts
git commit -m "feat(cards): create/update/list loyalty programs (passkit deferred)"
```

---

## Task 8: Settings Server Actions (Update Merchant + Set PIN)

**Files:**
- `src/lib/actions/__tests__/settings.test.ts`
- `src/lib/actions/settings.ts`

- [ ] Write `src/lib/actions/__tests__/settings.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const merchantUpdate = vi.fn();
const staffPinDeleteMany = vi.fn();
const staffPinCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    merchant: { update: merchantUpdate },
    staffPin: { deleteMany: staffPinDeleteMany, create: staffPinCreate },
    $transaction: vi.fn(async (cb) =>
      cb({
        staffPin: { deleteMany: staffPinDeleteMany, create: staffPinCreate },
      }),
    ),
  },
}));

const requireMerchant = vi.fn();
vi.mock("@/lib/auth/current-merchant", () => ({
  requireMerchant: () => requireMerchant(),
  getClerkUserIdOrThrow: vi.fn().mockResolvedValue("user_x"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/pin", () => ({
  hashPin: vi.fn(async (pin) => `hashed:${pin}`),
}));

import { updateMerchantProfile, setStaffPin } from "@/lib/actions/settings";

describe("updateMerchantProfile", () => {
  beforeEach(() => {
    merchantUpdate.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("rejects empty payload", async () => {
    const r = await updateMerchantProfile({});
    expect(r.ok).toBe(false);
  });

  it("updates only provided fields", async () => {
    merchantUpdate.mockResolvedValue({ id: "m_1" });
    const r = await updateMerchantProfile({ brandColor: "#ff0000" });
    expect(r.ok).toBe(true);
    expect(merchantUpdate).toHaveBeenCalledWith({
      where: { id: "m_1" },
      data: { brandColor: "#ff0000" },
    });
  });
});

describe("setStaffPin", () => {
  beforeEach(() => {
    staffPinDeleteMany.mockReset();
    staffPinCreate.mockReset();
    requireMerchant.mockResolvedValue({ id: "m_1" });
  });

  it("rejects mismatched confirm", async () => {
    const r = await setStaffPin({ pin: "1234", confirmPin: "0000" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-digit pin", async () => {
    const r = await setStaffPin({ pin: "abcd", confirmPin: "abcd" });
    expect(r.ok).toBe(false);
  });

  it("replaces existing pin atomically", async () => {
    staffPinCreate.mockResolvedValue({ id: "sp_1" });
    const r = await setStaffPin({ pin: "1234", confirmPin: "1234" });
    expect(r.ok).toBe(true);
    expect(staffPinDeleteMany).toHaveBeenCalledWith({ where: { merchantId: "m_1" } });
    expect(staffPinCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "m_1",
        pinHash: "hashed:1234",
        label: "default",
      }),
    });
  });
});
```

- [ ] Run to confirm fail:
```bash
bun run test src/lib/actions/__tests__/settings.test.ts
```

- [ ] Implement `src/lib/actions/settings.ts`:
```ts
"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/auth/current-merchant";
import {
  updateMerchantSchema,
  setStaffPinSchema,
  type UpdateMerchantInput,
  type SetStaffPinInput,
} from "@/lib/validation/merchant";
import { hashPin } from "@/lib/pin";
import type { ActionResult } from "@/lib/actions/onboarding";

export async function updateMerchantProfile(
  input: UpdateMerchantInput,
): Promise<ActionResult<{ id: string }>> {
  const merchant = await requireMerchant();
  const parsed = updateMerchantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid update payload",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.vertical !== undefined) data.vertical = parsed.data.vertical;
  if (parsed.data.logoUrl !== undefined) data.logoUrl = parsed.data.logoUrl;
  if (parsed.data.brandColor !== undefined) data.brandColor = parsed.data.brandColor;

  const updated = await prisma.merchant.update({
    where: { id: merchant.id },
    data,
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, data: { id: updated.id } };
}

export async function setStaffPin(
  input: SetStaffPinInput,
): Promise<ActionResult<{ ok: true }>> {
  const merchant = await requireMerchant();
  const parsed = setStaffPinSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid PIN",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const pinHash = await hashPin(parsed.data.pin);

  await prisma.$transaction(async (tx) => {
    await tx.staffPin.deleteMany({ where: { merchantId: merchant.id } });
    await tx.staffPin.create({
      data: {
        merchantId: merchant.id,
        pinHash,
        label: "default",
      },
    });
  });

  revalidatePath("/settings");
  return { ok: true, data: { ok: true } };
}
```

- [ ] Run to confirm pass:
```bash
bun run test src/lib/actions/__tests__/settings.test.ts
```

- [ ] Commit:
```bash
git add src/lib/actions/settings.ts src/lib/actions/__tests__/settings.test.ts
git commit -m "feat(settings): update merchant profile + atomic staff pin replace"
```

---

## Task 9: Reusable UI — Stepper

**Files:**
- `src/components/merchant/Stepper.tsx`

- [ ] Implement `src/components/merchant/Stepper.tsx`:
```tsx
"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type StepperStep = {
  id: number;
  label: string;
};

type Props = {
  steps: StepperStep[];
  current: number; // 1-indexed
  className?: string;
};

export function Stepper({ steps, current, className }: Props) {
  return (
    <ol
      className={cn("flex items-center justify-between gap-2 w-full", className)}
      aria-label="Onboarding progress"
    >
      {steps.map((step, i) => {
        const isDone = step.id < current;
        const isActive = step.id === current;
        return (
          <li key={step.id} className="flex-1 flex items-center gap-2">
            <div
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border transition-colors",
                isDone && "bg-primary text-primary-foreground border-primary",
                isActive && "bg-primary/10 text-primary border-primary",
                !isDone && !isActive && "bg-muted text-muted-foreground border-border",
              )}
            >
              {isDone ? <Check className="h-4 w-4" aria-hidden /> : step.id}
            </div>
            <span
              className={cn(
                "text-sm hidden sm:inline",
                isActive ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-px mx-2 transition-colors",
                  isDone ? "bg-primary" : "bg-border",
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] Commit:
```bash
git add src/components/merchant/Stepper.tsx
git commit -m "feat(ui): merchant Stepper component"
```

---

## Task 10: Reusable UI — ColorPicker

**Files:**
- `src/components/merchant/ColorPicker.tsx`

- [ ] Implement `src/components/merchant/ColorPicker.tsx`:
```tsx
"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESETS = [
  "#0F172A", "#1E40AF", "#0F766E", "#15803D", "#B45309",
  "#9F1239", "#7C3AED", "#0E7490", "#374151", "#000000",
];

type Props = {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  className?: string;
};

export function ColorPicker({ value, onChange, label = "Brand color", className }: Props) {
  const id = useId();
  return (
    <div className={cn("space-y-3", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-14 rounded-md border border-border cursor-pointer bg-transparent"
          aria-label={`${label} swatch`}
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            onChange(v.slice(0, 7).toUpperCase());
          }}
          maxLength={7}
          placeholder="#1A2B3C"
          className="font-mono w-32 uppercase"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color presets">
        {PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={value.toUpperCase() === hex.toUpperCase()}
            onClick={() => onChange(hex)}
            className={cn(
              "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
              value.toUpperCase() === hex.toUpperCase()
                ? "border-foreground ring-2 ring-offset-2 ring-foreground"
                : "border-border",
            )}
            style={{ backgroundColor: hex }}
            aria-label={`Use color ${hex}`}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] Commit:
```bash
git add src/components/merchant/ColorPicker.tsx
git commit -m "feat(ui): ColorPicker with hex input + preset palette"
```

---

## Task 11: Reusable UI — FileDropzone

**Files:**
- `src/components/merchant/FileDropzone.tsx`

- [ ] Implement `src/components/merchant/FileDropzone.tsx`:
```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Props = {
  value?: string | null; // existing URL
  onFileSelected: (file: File) => void | Promise<void>;
  onCleared?: () => void;
  accept?: string;
  maxBytes?: number;
  busy?: boolean;
  className?: string;
};

export function FileDropzone({
  value,
  onFileSelected,
  onCleared,
  accept = "image/png,image/svg+xml,image/jpeg,image/webp",
  maxBytes = 2 * 1024 * 1024,
  busy = false,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (f: File) => {
      setError(null);
      if (f.size > maxBytes) {
        setError(`File too large. Max ${(maxBytes / 1024 / 1024).toFixed(1)}MB.`);
        return;
      }
      void onFileSelected(f);
    },
    [maxBytes, onFileSelected],
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 cursor-pointer transition-colors",
          hover && "bg-muted border-primary",
          busy && "opacity-60 pointer-events-none",
        )}
        aria-label="Upload logo"
      >
        {value ? (
          <div className="relative h-24 w-24">
            <Image
              src={value}
              alt="Logo preview"
              fill
              sizes="96px"
              className="object-contain"
              unoptimized={value.endsWith(".svg")}
            />
          </div>
        ) : (
          <>
            <UploadCloud className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Drop logo here or click to upload</p>
            <p className="text-xs text-muted-foreground">PNG, SVG, JPG or WEBP — max 2MB</p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {value && onCleared && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCleared}
          className="text-muted-foreground"
        >
          <X className="h-4 w-4 mr-1" aria-hidden />
          Remove
        </Button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] Commit:
```bash
git add src/components/merchant/FileDropzone.tsx
git commit -m "feat(ui): FileDropzone with drag-drop + click + 2MB cap"
```

---

## Task 12: Reusable UI — PassPreview

**Files:**
- `src/components/merchant/PassPreview.tsx`

- [ ] Implement `src/components/merchant/PassPreview.tsx`:
```tsx
"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type Props = {
  merchantName: string;
  logoUrl?: string | null;
  brandColor: string;
  programName: string;
  stampsRequired: number;
  stampsCount?: number;
  rewardLabel: string;
  className?: string;
};

function getContrastTextColor(hex: string): "#ffffff" | "#0f172a" {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // YIQ luminance
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y >= 160 ? "#0f172a" : "#ffffff";
}

export function PassPreview({
  merchantName,
  logoUrl,
  brandColor,
  programName,
  stampsRequired,
  stampsCount = 0,
  rewardLabel,
  className,
}: Props) {
  const fg = getContrastTextColor(brandColor);
  const stamps = Array.from({ length: stampsRequired }, (_, i) => i < stampsCount);

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[340px] rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/10",
        className,
      )}
      style={{ backgroundColor: brandColor, color: fg }}
      role="img"
      aria-label={`Apple Wallet preview for ${merchantName}`}
    >
      <div className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <div className="relative h-10 w-10 rounded-md bg-white/95 p-1">
              <Image
                src={logoUrl}
                alt={`${merchantName} logo`}
                fill
                sizes="40px"
                className="object-contain"
                unoptimized={logoUrl.endsWith(".svg")}
              />
            </div>
          ) : (
            <div
              className="h-10 w-10 rounded-md bg-white/15 flex items-center justify-center text-xs font-semibold"
              aria-hidden
            >
              {merchantName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="text-sm font-semibold tracking-tight truncate max-w-[180px]">
            {merchantName}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest opacity-70">Loyalty</span>
      </div>

      <div className="px-5 pb-2">
        <p className="text-xs uppercase tracking-wider opacity-75">{programName}</p>
        <p className="text-2xl font-bold mt-1">
          {stampsCount} <span className="opacity-60 text-base">/ {stampsRequired}</span>
        </p>
      </div>

      <div className="px-5 pb-5">
        <div className="grid grid-cols-5 gap-2">
          {stamps.map((filled, i) => (
            <div
              key={i}
              className={cn(
                "aspect-square rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors",
                filled ? "bg-white text-black border-white" : "border-white/40 bg-transparent",
              )}
              aria-label={`Stamp ${i + 1} ${filled ? "filled" : "empty"}`}
            >
              {filled ? "★" : ""}
            </div>
          ))}
        </div>
      </div>

      <div
        className="px-5 py-3 text-xs flex items-center justify-between"
        style={{ backgroundColor: "rgba(0,0,0,0.18)" }}
      >
        <span className="opacity-70">Reward</span>
        <span className="font-medium truncate max-w-[200px]">{rewardLabel}</span>
      </div>
    </div>
  );
}
```

- [ ] Commit:
```bash
git add src/components/merchant/PassPreview.tsx
git commit -m "feat(ui): PassPreview wallet-style mock with contrast-aware text"
```

---

## Task 13: Merchant Layout (Auth Gate + Onboarding Redirect)

**Files:**
- `src/app/[locale]/(merchant)/layout.tsx`

- [ ] Implement `src/app/[locale]/(merchant)/layout.tsx`:
```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";

export default async function MerchantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) {
    const locale = await getLocale();
    redirect(`/${locale}/sign-in`);
  }

  const merchant = await prisma.merchant.findUnique({
    where: { clerkUserId: userId },
    select: { id: true, slug: true },
  });

  // Determine current path so we don't loop on /onboarding itself
  const h = await headers();
  const path = h.get("x-pathname") ?? h.get("x-invoke-path") ?? "";
  const isOnboardingRoute = path.endsWith("/onboarding");

  if (!merchant && !isOnboardingRoute) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-dvh bg-background">
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
```

- [ ] Add lightweight middleware augmentation so `x-pathname` is always present (in `src/middleware.ts`, only if Plan 1 didn't already do this):
```ts
// In existing clerkMiddleware/next-intl middleware, ensure response headers include:
// response.headers.set("x-pathname", request.nextUrl.pathname);
// (If Plan 1 owns middleware, append the line; do not duplicate the file.)
```
> If middleware is already owned by Plan 1, leave a comment in the layout explaining the dependency and use a fallback: read `path` from `headers().get("next-url")` if available, else default to "".

- [ ] Commit:
```bash
git add src/app/[locale]/\(merchant\)/layout.tsx
git commit -m "feat(merchant): clerk-gated layout with onboarding redirect"
```

---

## Task 14: Onboarding Page + Wizard

**Files:**
- `src/app/[locale]/(merchant)/onboarding/page.tsx`
- `src/app/[locale]/(merchant)/onboarding/_components/OnboardingWizard.tsx`
- `src/app/[locale]/(merchant)/onboarding/_components/Step1Business.tsx`
- `src/app/[locale]/(merchant)/onboarding/_components/Step2Branding.tsx`
- `src/app/[locale]/(merchant)/onboarding/_components/Step3Review.tsx`

- [ ] `src/app/[locale]/(merchant)/onboarding/page.tsx`:
```tsx
import { OnboardingWizard } from "./_components/OnboardingWizard";
import { getCurrentMerchant } from "@/lib/auth/current-merchant";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const merchant = await getCurrentMerchant();

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-8">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to stampme</h1>
        <p className="text-muted-foreground">Let’s set up your business in 3 quick steps.</p>
      </header>
      <OnboardingWizard
        initial={{
          name: merchant?.name ?? "",
          vertical: merchant?.vertical ?? "CAFE",
          logoUrl: merchant?.logoUrl ?? undefined,
          brandColor: merchant?.brandColor ?? "#0F172A",
        }}
        merchantId={merchant?.id ?? null}
      />
    </div>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/onboarding/_components/OnboardingWizard.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Stepper } from "@/components/merchant/Stepper";
import { Button } from "@/components/ui/button";
import { Step1Business } from "./Step1Business";
import { Step2Branding } from "./Step2Branding";
import { Step3Review } from "./Step3Review";
import { finishOnboarding } from "@/lib/actions/onboarding";
import type { Vertical } from "@/lib/validation/merchant";

const STEPS = [
  { id: 1, label: "Business" },
  { id: 2, label: "Branding" },
  { id: 3, label: "Review" },
];

export type OnboardingState = {
  name: string;
  vertical: Vertical;
  logoUrl?: string;
  brandColor: string;
};

type Props = {
  initial: OnboardingState;
  merchantId: string | null;
};

export function OnboardingWizard({ initial, merchantId }: Props) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<OnboardingState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const canNext =
    (step === 1 && state.name.trim().length >= 2) ||
    (step === 2 && /^#[0-9a-fA-F]{6}$/.test(state.brandColor)) ||
    step === 3;

  function handleFinish() {
    setError(null);
    startTransition(async () => {
      const result = await finishOnboarding({
        name: state.name,
        vertical: state.vertical,
        brandColor: state.brandColor,
        logoUrl: state.logoUrl,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/cards/new");
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <Stepper steps={STEPS} current={step} />

      <div className="bg-card border border-border rounded-xl p-6">
        {step === 1 && (
          <Step1Business
            value={{ name: state.name, vertical: state.vertical }}
            onChange={(v) => setState((s) => ({ ...s, ...v }))}
          />
        )}
        {step === 2 && (
          <Step2Branding
            merchantId={merchantId ?? "pending"}
            value={{ logoUrl: state.logoUrl, brandColor: state.brandColor }}
            onChange={(v) => setState((s) => ({ ...s, ...v }))}
          />
        )}
        {step === 3 && <Step3Review state={state} />}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive text-center">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || isPending}
        >
          Back
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Continue
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={isPending}>
            {isPending ? "Finishing..." : "Finish & design my card"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/onboarding/_components/Step1Business.tsx`:
```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VERTICALS, type Vertical } from "@/lib/validation/merchant";

const LABELS: Record<Vertical, string> = {
  CAFE: "Cafe / Coffee",
  SALON: "Salon / Barber",
  JUICE: "Juice bar",
  BAKERY: "Bakery / Sweets",
  LAUNDRY: "Laundry",
  OTHER: "Other",
};

type Props = {
  value: { name: string; vertical: Vertical };
  onChange: (v: { name?: string; vertical?: Vertical }) => void;
};

export function Step1Business({ value, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Tell us about your business</h2>
        <p className="text-sm text-muted-foreground">This appears on your loyalty card.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="biz-name">Business name</Label>
        <Input
          id="biz-name"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Mocha Bros"
          maxLength={80}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="biz-vertical">Vertical</Label>
        <Select
          value={value.vertical}
          onValueChange={(v) => onChange({ vertical: v as Vertical })}
        >
          <SelectTrigger id="biz-vertical">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERTICALS.map((v) => (
              <SelectItem key={v} value={v}>
                {LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/onboarding/_components/Step2Branding.tsx`:
```tsx
"use client";

import { useState } from "react";
import { ColorPicker } from "@/components/merchant/ColorPicker";
import { FileDropzone } from "@/components/merchant/FileDropzone";
import { uploadLogo } from "@/lib/actions/upload";

type Props = {
  merchantId: string;
  value: { logoUrl?: string; brandColor: string };
  onChange: (v: { logoUrl?: string; brandColor?: string }) => void;
};

export function Step2Branding({ merchantId, value, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("merchantId", merchantId);
      const result = await uploadLogo(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange({ logoUrl: result.url });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Make it yours</h2>
        <p className="text-sm text-muted-foreground">
          Upload your logo and pick the color that represents your brand.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Logo</p>
        <FileDropzone
          value={value.logoUrl ?? null}
          onFileSelected={handleFile}
          onCleared={() => onChange({ logoUrl: undefined })}
          busy={busy}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <ColorPicker
        value={value.brandColor}
        onChange={(c) => onChange({ brandColor: c })}
      />
    </div>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/onboarding/_components/Step3Review.tsx`:
```tsx
"use client";

import { PassPreview } from "@/components/merchant/PassPreview";
import type { OnboardingState } from "./OnboardingWizard";

type Props = { state: OnboardingState };

export function Step3Review({ state }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Looking good — ready to finish?</h2>
        <p className="text-sm text-muted-foreground">
          You can change everything later from Settings.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-6 items-start">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Business</dt>
            <dd className="font-medium">{state.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Vertical</dt>
            <dd className="font-medium">{state.vertical}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Logo</dt>
            <dd className="font-medium">{state.logoUrl ? "Uploaded" : "—"}</dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-muted-foreground">Brand color</dt>
            <dd className="font-mono flex items-center gap-2">
              <span
                className="h-4 w-4 rounded border border-border"
                style={{ backgroundColor: state.brandColor }}
                aria-hidden
              />
              {state.brandColor}
            </dd>
          </div>
        </dl>
        <PassPreview
          merchantName={state.name || "Your business"}
          logoUrl={state.logoUrl}
          brandColor={state.brandColor}
          programName="Sample loyalty"
          stampsRequired={10}
          stampsCount={3}
          rewardLabel="Free coffee"
        />
      </div>
    </div>
  );
}
```

- [ ] Manual smoke test:
```bash
bun run dev
# Visit /en/onboarding while signed in (no merchant in DB) — verify wizard renders
```

- [ ] Commit:
```bash
git add src/app/[locale]/\(merchant\)/onboarding
git commit -m "feat(onboarding): 3-step wizard with logo upload and live pass preview"
```

---

## Task 15: Card Designer — `/cards/new`

**Files:**
- `src/app/[locale]/(merchant)/cards/new/page.tsx`
- `src/app/[locale]/(merchant)/cards/_components/CardDesigner.tsx`

- [ ] `src/app/[locale]/(merchant)/cards/new/page.tsx`:
```tsx
import { requireMerchant } from "@/lib/auth/current-merchant";
import { CardDesigner } from "../_components/CardDesigner";

export const dynamic = "force-dynamic";

export default async function NewCardPage() {
  const merchant = await requireMerchant();
  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Design your loyalty card</h1>
        <p className="text-muted-foreground">
          Customers will add this to their Apple or Google Wallet.
        </p>
      </header>
      <CardDesigner
        merchant={{
          name: merchant.name,
          logoUrl: merchant.logoUrl,
          brandColor: merchant.brandColor,
        }}
        mode="create"
      />
    </div>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/cards/_components/CardDesigner.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { PassPreview } from "@/components/merchant/PassPreview";
import { createCard, updateCard } from "@/lib/actions/cards";
import { createCardSchema } from "@/lib/validation/card";

type MerchantSummary = {
  name: string;
  logoUrl: string | null;
  brandColor: string;
};

type Props =
  | {
      merchant: MerchantSummary;
      mode: "create";
    }
  | {
      merchant: MerchantSummary;
      mode: "edit";
      card: {
        id: string;
        programName: string;
        stampsRequired: number;
        rewardLabel: string;
      };
    };

export function CardDesigner(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial =
    props.mode === "edit"
      ? props.card
      : { id: undefined, programName: "Loyalty card", stampsRequired: 10, rewardLabel: "Free coffee" };

  const [programName, setProgramName] = useState(initial.programName);
  const [stampsRequired, setStampsRequired] = useState(initial.stampsRequired);
  const [rewardLabel, setRewardLabel] = useState(initial.rewardLabel);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createCardSchema.safeParse({
      programName,
      stampsRequired,
      rewardLabel,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(", "));
      return;
    }

    startTransition(async () => {
      const result =
        props.mode === "edit"
          ? await updateCard({
              id: props.card.id,
              programName,
              stampsRequired,
              rewardLabel,
            })
          : await createCard({ programName, stampsRequired, rewardLabel });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid lg:grid-cols-2 gap-8">
      <section className="space-y-6 bg-card border border-border rounded-xl p-6">
        <div className="space-y-2">
          <Label htmlFor="program-name">Program name</Label>
          <Input
            id="program-name"
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            maxLength={60}
            placeholder="Coffee Lovers"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="stamps">Stamps required</Label>
            <span className="text-sm font-mono">{stampsRequired}</span>
          </div>
          <Slider
            id="stamps"
            min={5}
            max={20}
            step={1}
            value={[stampsRequired]}
            onValueChange={(v) => setStampsRequired(v[0] ?? 10)}
          />
          <p className="text-xs text-muted-foreground">Between 5 and 20 stamps.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reward">Reward label</Label>
          <Input
            id="reward"
            value={rewardLabel}
            onChange={(e) => setRewardLabel(e.target.value)}
            maxLength={50}
            placeholder="Free coffee — قهوة مجانية"
            required
          />
          <p className="text-xs text-muted-foreground">
            {rewardLabel.length}/50 — show both Arabic and English here for now.
          </p>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending
              ? "Saving..."
              : props.mode === "edit"
                ? "Save changes"
                : "Create card"}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-sm text-muted-foreground text-center">Live preview</p>
        <PassPreview
          merchantName={props.merchant.name}
          logoUrl={props.merchant.logoUrl}
          brandColor={props.merchant.brandColor}
          programName={programName || "Your program"}
          stampsRequired={stampsRequired}
          stampsCount={Math.min(3, stampsRequired)}
          rewardLabel={rewardLabel || "Reward"}
        />
      </section>
    </form>
  );
}
```

- [ ] If shadcn `Slider` isn't installed yet, add it:
```bash
bunx shadcn@latest add slider
```

- [ ] Commit:
```bash
git add src/app/[locale]/\(merchant\)/cards
git commit -m "feat(cards): card designer with live pass preview and slider"
```

---

## Task 16: Card Edit Page — `/cards/[id]/edit`

**Files:**
- `src/app/[locale]/(merchant)/cards/[id]/edit/page.tsx`

- [ ] Implement:
```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/auth/current-merchant";
import { CardDesigner } from "../../_components/CardDesigner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; locale: string }> };

export default async function EditCardPage({ params }: Params) {
  const { id } = await params;
  const merchant = await requireMerchant();

  const program = await prisma.loyaltyProgram.findFirst({
    where: { id, merchantId: merchant.id },
  });
  if (!program) notFound();

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Edit loyalty card</h1>
        <p className="text-muted-foreground">Changes apply to new passes immediately.</p>
      </header>
      <CardDesigner
        merchant={{
          name: merchant.name,
          logoUrl: merchant.logoUrl,
          brandColor: merchant.brandColor,
        }}
        mode="edit"
        card={{
          id: program.id,
          programName: program.name,
          stampsRequired: program.stampsRequired,
          rewardLabel: program.rewardLabel,
        }}
      />
    </div>
  );
}
```

- [ ] Commit:
```bash
git add src/app/[locale]/\(merchant\)/cards/\[id\]/edit/page.tsx
git commit -m "feat(cards): edit card page with ownership check"
```

---

## Task 17: Settings Page

**Files:**
- `src/app/[locale]/(merchant)/settings/page.tsx`
- `src/app/[locale]/(merchant)/settings/_components/ProfileForm.tsx`
- `src/app/[locale]/(merchant)/settings/_components/StaffPinForm.tsx`
- `src/app/[locale]/(merchant)/settings/_components/SlugCard.tsx`

- [ ] `src/app/[locale]/(merchant)/settings/page.tsx`:
```tsx
import { requireMerchant } from "@/lib/auth/current-merchant";
import { prisma } from "@/lib/db";
import { ProfileForm } from "./_components/ProfileForm";
import { StaffPinForm } from "./_components/StaffPinForm";
import { SlugCard } from "./_components/SlugCard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const merchant = await requireMerchant();
  const pinExists = await prisma.staffPin.findFirst({
    where: { merchantId: merchant.id },
    select: { id: true },
  });

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your business profile and staff access.</p>
      </header>

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Business profile</h2>
        <ProfileForm
          merchant={{
            id: merchant.id,
            name: merchant.name,
            vertical: merchant.vertical,
            logoUrl: merchant.logoUrl,
            brandColor: merchant.brandColor,
          }}
        />
      </section>

      <SlugCard slug={merchant.slug} />

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Staff PIN</h2>
        <p className="text-sm text-muted-foreground">
          Cashiers enter this 4-digit PIN to access the scanner. One PIN per business for now.
        </p>
        <StaffPinForm hasExistingPin={Boolean(pinExists)} />
      </section>
    </div>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/settings/_components/ProfileForm.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/merchant/ColorPicker";
import { FileDropzone } from "@/components/merchant/FileDropzone";
import { updateMerchantProfile } from "@/lib/actions/settings";
import { uploadLogo } from "@/lib/actions/upload";
import type { Vertical } from "@/lib/validation/merchant";

type Props = {
  merchant: {
    id: string;
    name: string;
    vertical: Vertical;
    logoUrl: string | null;
    brandColor: string;
  };
};

export function ProfileForm({ merchant }: Props) {
  const [name, setName] = useState(merchant.name);
  const [logoUrl, setLogoUrl] = useState<string | null>(merchant.logoUrl);
  const [brandColor, setBrandColor] = useState(merchant.brandColor);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onFile(f: File) {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("merchantId", merchant.id);
      const result = await uploadLogo(fd);
      if (!result.ok) {
        setMsg({ kind: "err", text: result.error });
        return;
      }
      setLogoUrl(result.url);
    } finally {
      setBusy(false);
    }
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await updateMerchantProfile({
        name,
        logoUrl: logoUrl ?? undefined,
        brandColor,
      });
      setMsg(
        r.ok
          ? { kind: "ok", text: "Saved" }
          : { kind: "err", text: r.error },
      );
    });
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="s-name">Business name</Label>
        <Input
          id="s-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Logo</Label>
        <FileDropzone
          value={logoUrl}
          onFileSelected={onFile}
          onCleared={() => setLogoUrl(null)}
          busy={busy}
        />
      </div>

      <ColorPicker value={brandColor} onChange={setBrandColor} />

      {msg && (
        <p
          role="status"
          className={msg.kind === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"}
        >
          {msg.text}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || busy}>
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/settings/_components/StaffPinForm.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { setStaffPin } from "@/lib/actions/settings";

type Props = { hasExistingPin: boolean };

export function StaffPinForm({ hasExistingPin }: Props) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await setStaffPin({ pin, confirmPin });
      if (r.ok) {
        setMsg({ kind: "ok", text: "PIN saved" });
        setPin("");
        setConfirmPin("");
      } else {
        setMsg({ kind: "err", text: r.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {hasExistingPin && (
        <p className="text-xs text-muted-foreground">
          A PIN is already set. Submitting a new one will replace it immediately.
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="pin">New PIN</Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm PIN</Label>
          <Input
            id="confirm"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
      </div>

      {msg && (
        <p
          role="status"
          className={msg.kind === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"}
        >
          {msg.text}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : hasExistingPin ? "Reset PIN" : "Set PIN"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] `src/app/[locale]/(merchant)/settings/_components/SlugCard.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SlugCard({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/c/${slug}` : `/c/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-3">
      <h2 className="text-lg font-semibold">Enrollment URL</h2>
      <p className="text-sm text-muted-foreground">
        Share this link or the QR code (Plan 4) to let customers add your card to their wallet.
      </p>
      <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 font-mono text-sm">
        <span className="truncate flex-1">{url}</span>
        <Button type="button" size="sm" variant="ghost" onClick={copy} aria-label="Copy URL">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </section>
  );
}
```

- [ ] Commit:
```bash
git add src/app/[locale]/\(merchant\)/settings
git commit -m "feat(settings): merchant profile, staff pin reset, enrollment slug card"
```

---

## Task 18: Integration Smoke Test (Manual + Automated)

**Files:**
- `src/lib/__tests__/integration-smoke.test.ts`

- [ ] Add a thin integration smoke test that wires action exports and checks they don't blow up at import time:
```ts
import { describe, it, expect } from "vitest";

describe("plan-2 surface area", () => {
  it("server actions are exported", async () => {
    const onboarding = await import("@/lib/actions/onboarding");
    const cards = await import("@/lib/actions/cards");
    const settings = await import("@/lib/actions/settings");
    const upload = await import("@/lib/actions/upload");

    expect(typeof onboarding.finishOnboarding).toBe("function");
    expect(typeof cards.createCard).toBe("function");
    expect(typeof cards.updateCard).toBe("function");
    expect(typeof cards.listCards).toBe("function");
    expect(typeof settings.updateMerchantProfile).toBe("function");
    expect(typeof settings.setStaffPin).toBe("function");
    expect(typeof upload.uploadLogo).toBe("function");
  });

  it("validation schemas export expected shapes", async () => {
    const m = await import("@/lib/validation/merchant");
    const c = await import("@/lib/validation/card");
    expect(m.VERTICALS).toContain("CAFE");
    expect(c.createCardSchema.shape.programName).toBeDefined();
  });
});
```

- [ ] Run all tests:
```bash
bun run test
```

- [ ] Manual flow check:
  1. `bun run dev`
  2. Sign in with Clerk → expect redirect to `/onboarding`
  3. Complete wizard with logo + color → land on `/cards/new`
  4. Save card → land on `/dashboard` (Plan 7 page; ok if 404 — verify Postgres row exists with `passKitProgramId IS NULL`)
  5. Visit `/settings` → change brand color → save → reload → persists
  6. Set PIN `1234` → confirm `staff_pins` row created with argon2 hash

- [ ] Commit:
```bash
git add src/lib/__tests__/integration-smoke.test.ts
git commit -m "test(plan-2): export surface smoke test"
```

---

## Task 19: Lint, Typecheck, Final Verification

**Files:** none (verification only)

- [ ] Typecheck:
```bash
bun run typecheck
# or: bunx tsc --noEmit
```

- [ ] Lint:
```bash
bun run lint
```

- [ ] Full test suite:
```bash
bun run test
```

- [ ] Build:
```bash
bun run build
```

- [ ] Confirm DB rows after a manual run:
```bash
bunx prisma studio
# verify: Merchant has slug + brandColor + logoUrl
# verify: LoyaltyProgram has passKitProgramId = null
# verify: StaffPin.pinHash starts with $argon2
```

- [ ] Final commit (only if any cleanups happened):
```bash
git add -A
git commit -m "chore(plan-2): final lint/type/build cleanup"
```

---

## Hand-off Notes for Plan 3 (PassKit)

- All `LoyaltyProgram.passKitProgramId` rows are currently `null`. Plan 3 must:
  1. On startup or via a backfill script, iterate `findMany({ where: { passKitProgramId: null } })` → call PassKit `POST /programs` → patch.
  2. Modify `createCard` action to call PassKit synchronously after the DB insert, wrapped in try/catch with a queued retry on failure.
  3. Add the same hook on `updateMerchantProfile` for logo/brand changes (PassKit `PUT /programs/{id}/templates`).
- All logo URLs are R2 CDN URLs. Plan 3 can pass them straight to PassKit.
- `Merchant.ownerEmail` and `ownerPhone` may be empty strings — Plan 1 should ideally populate these from Clerk; if not, Plan 3 should backfill from Clerk's user object before any PassKit call (PassKit may require contact info).

## Open Concerns

- **Middleware `x-pathname` header**: Task 13 assumes Plan 1's middleware sets it. If not, the onboarding redirect loop guard will not work. Add the line to Plan 1's middleware before merging.
- **`requireMerchant` import in tests**: We mock `@/lib/auth/current-merchant` in every server-action test. If Plan 1 puts auth helpers in a different path, update the mock paths.
- **Slider component**: Depends on shadcn `slider` being installed (Task 15 adds it). If Plan 1 already installed it, the bunx command is a no-op.
- **Argon2 native build**: `argon2` requires native compilation. On Vercel, ensure the build image supports it; if not, swap to `bcryptjs` (slightly weaker but pure JS) — change is isolated to `src/lib/pin.ts`.
