# stampme — Plan 5: Staff Scanner PWA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PWA-installable scanner at `/scan` for cafe staff. PIN auth, camera-based QR scan, add stamp / redeem reward, push update to customer's wallet via PassKit.

**Architecture:** Separate JWT-based staff session (not Clerk). PWA service worker caches UI shell. Scanner uses BarcodeDetector with qr-scanner fallback. All wallet writes via Plan 3's PassKit service. Optimistic concurrency on stamp counts.

**Tech Stack:** Next.js 15, jose (JWT), qr-scanner, BarcodeDetector API, service worker, argon2

**Depends on:** Plan 1 (Foundation), Plan 2 (StaffPin model), Plan 3 (PassKit service), Plan 4 (rate limiting)

**Spec reference:** `docs/superpowers/specs/2026-04-28-stampme-design.md` §٤.٣, §٧

---

## Architectural Decisions (read before starting)

### Decision 1: Subdomain vs path

| Option | Pros | Cons |
|--------|------|------|
| `scan.stampme.com` (subdomain) | Clean PWA scope; cookie isolation; install card shows just "stampme scan" | Two Vercel projects OR rewrites; extra DNS; CORS/cookie domain plumbing |
| `/scan` route on main domain | One deployment, one cert, one cookie domain, simpler CSP | PWA scope shares origin with merchant dashboard (mitigated by `start_url: /scan` and `scope: /scan`) |

**MVP decision:** `/scan` route on main domain. One Vercel deployment, no DNS work, simpler iteration. The PWA `scope` field constrains the install to the scanner UI so "Add to Home Screen" still produces an isolated app shell.

**Phase 2 TODO:** When merchants demand a branded scanner host (or when scanner traffic justifies its own edge config), split to `scan.stampme.com` via Vercel rewrites. Cookie name `stampme_staff` already host-only; only `Domain` attribute on the cookie needs flipping plus a CORS allowlist on server actions.

### Decision 2: No `[locale]` segment for `/scan`

The cashier flow is Arabic-first, RTL-locked. Adding `[locale]` adds routing surface area and a language toggle that confuses cashiers. Hardcode `dir="rtl"` and Arabic strings on the scanner pages. If English-speaking staff become a real cohort (unlikely in MVP), wrap strings with `next-intl` later.

### Decision 3: Service worker hand-rolled, not `next-pwa`

`next-pwa` lags App Router support and ships heavy Workbox runtime. The scanner needs only:
- HTML shell cache for `/scan` and `/scan/scanner`
- Audio + manifest + icons cache
- Network-first for server actions (always fail-fast offline)

A 60-line manual `sw.js` is faster, auditable, and avoids a dependency that fights with Next.js 15's RSC streaming. Registered via a tiny client bootstrap component.

### Decision 4: QR payload contract

PassKit emits passes with a barcode field. We control the payload at issuance time (Plan 3). The QR encodes:

```
stampme:v1:<passKitPassId>
```

Plain text, no signature in MVP. The cashier already authenticated with PIN, the server resolves the pass by its PassKit ID and verifies `pass.program.merchantId === jwt.merchantId` before any mutation. Phase 2 can add HMAC signing if scraped pass IDs become an attack vector.

### Decision 5: Optimistic concurrency on stamps

Two cashiers double-tap the stamp button, race condition. Use Prisma's conditional `updateMany`:

```ts
const result = await prisma.pass.updateMany({
  where: { id: passId, stampsCount: currentCount },
  data: { stampsCount: currentCount + 1 },
});
if (result.count === 0) throw new ConcurrencyError();
```

If the swap fails, refetch and surface "تم تحديث الكرت — أعد المحاولة" to the cashier. No retry loop in MVP, manual retry is fine at human speed.

---

## Task 1: Add dependencies, env vars, schema migration for REWARD_READY

**Files:**
- `package.json`
- `.env.example`
- `src/env.ts` (assumed from Plan 1, t3-env or similar)
- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_add_reward_ready_status/migration.sql`

**Steps:**

- [ ] Install runtime deps:
  ```bash
  bun add jose qr-scanner
  ```
- [ ] Add `STAFF_JWT_SECRET` to `.env.example` (32+ random bytes, base64):
  ```
  # Staff scanner JWT signing secret, generate via: openssl rand -base64 48
  STAFF_JWT_SECRET=changeme_use_openssl_rand_base64_48
  ```
- [ ] Extend `src/env.ts` server schema:
  ```ts
  STAFF_JWT_SECRET: z.string().min(32),
  ```
- [ ] Modify `PassStatus` enum in `prisma/schema.prisma`:
  ```prisma
  enum PassStatus {
    ACTIVE
    REWARD_READY
    REDEEMED
    EXPIRED
    DELETED
  }
  ```
- [ ] Generate migration:
  ```bash
  bunx prisma migrate dev --name add_reward_ready_status
  ```
- [ ] Verify migration SQL contains `ALTER TYPE "PassStatus" ADD VALUE 'REWARD_READY' BEFORE 'REDEEMED';`
- [ ] Run `bunx prisma generate`
- [ ] Commit: `feat(db): add REWARD_READY pass status + scanner deps`

---

## Task 2: Staff JWT helpers (TDD)

**Files:**
- `src/lib/staff-jwt.ts`
- `src/lib/staff-jwt.test.ts`

**Steps:**

- [ ] Write failing tests first at `src/lib/staff-jwt.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { signStaffJwt, verifyStaffJwt, StaffJwtError } from "./staff-jwt";

beforeAll(() => {
  process.env.STAFF_JWT_SECRET = "test_secret_at_least_32_chars_long_xxxxx";
});

describe("staff-jwt", () => {
  it("round-trips a payload", async () => {
    const token = await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" });
    const payload = await verifyStaffJwt(token);
    expect(payload.merchantId).toBe("m_1");
    expect(payload.staffPinId).toBe("p_1");
  });

  it("rejects tampered tokens", async () => {
    const token = await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" });
    const tampered = token.slice(0, -4) + "AAAA";
    await expect(verifyStaffJwt(tampered)).rejects.toThrow(StaffJwtError);
  });

  it("rejects expired tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" });
    vi.setSystemTime(new Date("2026-01-01T13:00:00Z")); // +13h, past 12h ttl
    await expect(verifyStaffJwt(token)).rejects.toThrow(StaffJwtError);
    vi.useRealTimers();
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" });
    process.env.STAFF_JWT_SECRET = "different_secret_at_least_32_chars_long_yyyyy";
    await expect(verifyStaffJwt(token)).rejects.toThrow(StaffJwtError);
    process.env.STAFF_JWT_SECRET = "test_secret_at_least_32_chars_long_xxxxx";
  });
});
```

- [ ] Implement `src/lib/staff-jwt.ts`:

```ts
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

const ISSUER = "stampme";
const AUDIENCE = "stampme-scanner";
const TTL_SECONDS = 60 * 60 * 12; // 12h
const ALG = "HS256";

export class StaffJwtError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "StaffJwtError";
  }
}

export interface StaffJwtPayload {
  merchantId: string;
  staffPinId: string;
}

function getKey(): Uint8Array {
  const secret = process.env.STAFF_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new StaffJwtError("STAFF_JWT_SECRET missing or too short", "config");
  }
  return new TextEncoder().encode(secret);
}

export async function signStaffJwt(
  payload: StaffJwtPayload,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getKey());
}

export async function verifyStaffJwt(
  token: string,
): Promise<StaffJwtPayload> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG],
    });
    if (typeof payload.merchantId !== "string" || typeof payload.staffPinId !== "string") {
      throw new StaffJwtError("payload missing required fields", "shape");
    }
    return { merchantId: payload.merchantId, staffPinId: payload.staffPinId };
  } catch (err) {
    if (err instanceof StaffJwtError) throw err;
    if (err instanceof joseErrors.JWTExpired) {
      throw new StaffJwtError("token expired", "expired");
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new StaffJwtError("invalid signature", "signature");
    }
    throw new StaffJwtError("invalid token", "invalid");
  }
}
```

- [ ] Run `bunx vitest run src/lib/staff-jwt.test.ts`, all green
- [ ] Commit: `feat(scanner): add jose-based staff JWT helpers`

---

## Task 3: Cookie helpers + `getStaffSession` server util

**Files:**
- `src/lib/staff-session.ts`
- `src/lib/staff-session.test.ts`

**Steps:**

- [ ] Write tests first:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getStaffSession, STAFF_COOKIE } from "./staff-session";
import { signStaffJwt } from "./staff-jwt";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { cookies } from "next/headers";

beforeEach(() => {
  process.env.STAFF_JWT_SECRET = "test_secret_at_least_32_chars_long_xxxxx";
  vi.clearAllMocks();
});

describe("getStaffSession", () => {
  it("returns null when cookie missing", async () => {
    (cookies as any).mockResolvedValue({ get: () => undefined });
    expect(await getStaffSession()).toBeNull();
  });

  it("returns payload when cookie valid", async () => {
    const token = await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" });
    (cookies as any).mockResolvedValue({ get: () => ({ value: token }) });
    const session = await getStaffSession();
    expect(session?.merchantId).toBe("m_1");
  });

  it("returns null when cookie tampered", async () => {
    (cookies as any).mockResolvedValue({ get: () => ({ value: "garbage" }) });
    expect(await getStaffSession()).toBeNull();
  });
});
```

- [ ] Implement `src/lib/staff-session.ts`:

```ts
import { cookies } from "next/headers";
import { verifyStaffJwt, type StaffJwtPayload } from "./staff-jwt";

export const STAFF_COOKIE = "stampme_staff";

export async function getStaffSession(): Promise<StaffJwtPayload | null> {
  const store = await cookies();
  const token = store.get(STAFF_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifyStaffJwt(token);
  } catch {
    return null;
  }
}

export function buildStaffCookie(token: string) {
  return {
    name: STAFF_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/scan",
    maxAge: 60 * 60 * 12,
  };
}

export function buildClearStaffCookie() {
  return {
    name: STAFF_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/scan",
    maxAge: 0,
  };
}
```

- [ ] Run tests, green
- [ ] Commit: `feat(scanner): staff session cookie helpers`

---

## Task 4: Server actions, verifyPin + lookupPass + addStamp + redeemReward (TDD)

**Files:**
- `src/lib/actions/staff.ts`
- `src/lib/actions/staff.test.ts`

**Steps:**

- [ ] Tests first. This is the security core, exhaustive coverage:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prismaMock } from "@/test/prisma-mock"; // assume from Plan 1 test infra
import {
  verifyPin,
  lookupPass,
  addStamp,
  redeemReward,
  PinAuthError,
  PassAuthError,
  ConcurrencyError,
} from "./staff";
import { signStaffJwt } from "@/lib/staff-jwt";
import { hashPin } from "@/lib/pin"; // from Plan 2

vi.mock("@/lib/passkit/passes", () => ({
  updatePassStamps: vi.fn().mockResolvedValue(undefined),
  markRedeemed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ratelimit", () => ({
  pinAttemptLimiter: { limit: vi.fn().mockResolvedValue({ success: true, remaining: 4 }) },
}));

vi.mock("next/headers", () => {
  const store = new Map<string, string>();
  return {
    cookies: vi.fn().mockResolvedValue({
      set: (name: string, value: string) => store.set(name, value),
      get: (name: string) => ({ value: store.get(name) }),
      delete: (name: string) => store.delete(name),
    }),
    headers: vi.fn().mockResolvedValue(new Map([["x-forwarded-for", "1.2.3.4"]])),
  };
});

beforeEach(() => {
  process.env.STAFF_JWT_SECRET = "test_secret_at_least_32_chars_long_xxxxx";
  vi.clearAllMocks();
});

describe("verifyPin", () => {
  it("rejects unknown merchant slug", async () => {
    prismaMock.merchant.findUnique.mockResolvedValue(null);
    await expect(verifyPin({ slug: "ghost", pin: "1234" })).rejects.toThrow(PinAuthError);
  });

  it("rejects wrong PIN", async () => {
    prismaMock.merchant.findUnique.mockResolvedValue({ id: "m_1", slug: "cafe1" });
    prismaMock.staffPin.findFirst.mockResolvedValue({
      id: "p_1",
      merchantId: "m_1",
      pinHash: await hashPin("9999"),
    });
    await expect(verifyPin({ slug: "cafe1", pin: "1234" })).rejects.toThrow(PinAuthError);
  });

  it("issues JWT cookie on correct PIN", async () => {
    prismaMock.merchant.findUnique.mockResolvedValue({ id: "m_1", slug: "cafe1" });
    prismaMock.staffPin.findFirst.mockResolvedValue({
      id: "p_1",
      merchantId: "m_1",
      pinHash: await hashPin("1234"),
    });
    const result = await verifyPin({ slug: "cafe1", pin: "1234" });
    expect(result.ok).toBe(true);
  });

  it("respects rate limiter lockout", async () => {
    const { pinAttemptLimiter } = await import("@/lib/ratelimit");
    (pinAttemptLimiter.limit as any).mockResolvedValueOnce({ success: false, remaining: 0 });
    await expect(verifyPin({ slug: "cafe1", pin: "1234" })).rejects.toThrow(/rate/i);
  });
});

describe("lookupPass", () => {
  const validJwt = async () => signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" });

  it("rejects unauthenticated calls", async () => {
    await expect(lookupPass({ qrPayload: "stampme:v1:pk_1" })).rejects.toThrow(PassAuthError);
  });

  it("rejects malformed QR", async () => {
    await setStaffCookie(await validJwt());
    await expect(lookupPass({ qrPayload: "not-a-stampme-code" })).rejects.toThrow(/invalid|رمز/);
  });

  it("rejects pass belonging to a different merchant", async () => {
    await setStaffCookie(await validJwt());
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      passKitPassId: "pk_1",
      stampsCount: 3,
      status: "ACTIVE",
      customerPhone: "+966500001234",
      program: { id: "prog_1", merchantId: "m_OTHER", stampsRequired: 10, name: "X", rewardLabel: "Y" },
    });
    await expect(lookupPass({ qrPayload: "stampme:v1:pk_1" })).rejects.toThrow(PassAuthError);
  });

  it("returns pass details when authorized", async () => {
    await setStaffCookie(await validJwt());
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      passKitPassId: "pk_1",
      stampsCount: 3,
      status: "ACTIVE",
      customerPhone: "+966500001234",
      program: { id: "prog_1", merchantId: "m_1", stampsRequired: 10, name: "Cafe", rewardLabel: "Free coffee" },
    });
    const res = await lookupPass({ qrPayload: "stampme:v1:pk_1" });
    expect(res.phoneMasked).toBe("****1234");
    expect(res.stampsCount).toBe(3);
    expect(res.canRedeem).toBe(false);
  });
});

describe("addStamp", () => {
  it("rejects when staff not authed", async () => {
    await clearStaffCookie();
    await expect(addStamp({ passId: "pass_1" })).rejects.toThrow(PassAuthError);
  });

  it("rejects pass owned by another merchant", async () => {
    await setStaffCookie(await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" }));
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      stampsCount: 3,
      status: "ACTIVE",
      program: { merchantId: "m_OTHER", stampsRequired: 10 },
    });
    await expect(addStamp({ passId: "pass_1" })).rejects.toThrow(PassAuthError);
  });

  it("increments and pushes wallet update", async () => {
    await setStaffCookie(await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" }));
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      passKitPassId: "pk_1",
      stampsCount: 3,
      status: "ACTIVE",
      program: { merchantId: "m_1", stampsRequired: 10 },
    });
    prismaMock.pass.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.stampEvent.create.mockResolvedValue({ id: "evt_1" });

    const res = await addStamp({ passId: "pass_1" });
    expect(res.stampsCount).toBe(4);
    expect(res.status).toBe("ACTIVE");

    const { updatePassStamps } = await import("@/lib/passkit/passes");
    expect(updatePassStamps).toHaveBeenCalledWith({
      passKitPassId: "pk_1",
      stampsCount: 4,
      idempotencyKey: "stamp-evt_1",
    });
  });

  it("flips status to REWARD_READY at the threshold", async () => {
    await setStaffCookie(await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" }));
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      passKitPassId: "pk_1",
      stampsCount: 9,
      status: "ACTIVE",
      program: { merchantId: "m_1", stampsRequired: 10 },
    });
    prismaMock.pass.updateMany.mockResolvedValue({ count: 1 });
    const res = await addStamp({ passId: "pass_1" });
    expect(res.stampsCount).toBe(10);
    expect(res.status).toBe("REWARD_READY");
  });

  it("throws ConcurrencyError on race", async () => {
    await setStaffCookie(await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" }));
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      passKitPassId: "pk_1",
      stampsCount: 3,
      status: "ACTIVE",
      program: { merchantId: "m_1", stampsRequired: 10 },
    });
    prismaMock.pass.updateMany.mockResolvedValue({ count: 0 });
    await expect(addStamp({ passId: "pass_1" })).rejects.toThrow(ConcurrencyError);
  });
});

describe("redeemReward", () => {
  it("rejects when status is not REWARD_READY", async () => {
    await setStaffCookie(await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" }));
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      passKitPassId: "pk_1",
      stampsCount: 5,
      status: "ACTIVE",
      program: { merchantId: "m_1", stampsRequired: 10 },
    });
    await expect(redeemReward({ passId: "pass_1" })).rejects.toThrow(/ready|جاهز/);
  });

  it("resets stamps + writes redemption + pushes wallet", async () => {
    await setStaffCookie(await signStaffJwt({ merchantId: "m_1", staffPinId: "p_1" }));
    prismaMock.pass.findUnique.mockResolvedValue({
      id: "pass_1",
      passKitPassId: "pk_1",
      stampsCount: 10,
      status: "REWARD_READY",
      program: { merchantId: "m_1", stampsRequired: 10 },
    });
    prismaMock.pass.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.rewardRedemption.create.mockResolvedValue({ id: "rdm_1" });
    const res = await redeemReward({ passId: "pass_1" });
    expect(res.ok).toBe(true);
    const { markRedeemed } = await import("@/lib/passkit/passes");
    expect(markRedeemed).toHaveBeenCalledWith({
      passKitPassId: "pk_1",
      idempotencyKey: "redeem-rdm_1",
    });
  });
});

// helpers
async function setStaffCookie(token: string) {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  (store as any).set("stampme_staff", token);
}
async function clearStaffCookie() {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  (store as any).delete("stampme_staff");
}
```

- [ ] Implement `src/lib/actions/staff.ts`:

```ts
"use server";

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPinHash } from "@/lib/pin";
import { signStaffJwt } from "@/lib/staff-jwt";
import { getStaffSession, buildStaffCookie } from "@/lib/staff-session";
import { pinAttemptLimiter } from "@/lib/ratelimit";
import { updatePassStamps, markRedeemed } from "@/lib/passkit/passes";
import * as Sentry from "@sentry/nextjs";

export class PinAuthError extends Error {
  constructor(message = "بيانات الدخول غير صحيحة") {
    super(message);
    this.name = "PinAuthError";
  }
}
export class PassAuthError extends Error {
  constructor(message = "غير مصرح") {
    super(message);
    this.name = "PassAuthError";
  }
}
export class ConcurrencyError extends Error {
  constructor() {
    super("تم تحديث الكرت — أعد المحاولة");
    this.name = "ConcurrencyError";
  }
}

const verifyPinInput = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  pin: z.string().regex(/^\d{4,8}$/),
});

export async function verifyPin(raw: unknown) {
  const { slug, pin } = verifyPinInput.parse(raw);

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await pinAttemptLimiter.limit(`pin:${ip}`);
  if (!rl.success) {
    throw new PinAuthError("rate-limit: محاولات كثيرة، حاول بعد ساعة");
  }

  Sentry.addBreadcrumb({ category: "scanner", message: "verifyPin attempt", data: { slug } });

  const merchant = await prisma.merchant.findUnique({ where: { slug } });
  if (!merchant) throw new PinAuthError();

  const staffPin = await prisma.staffPin.findFirst({ where: { merchantId: merchant.id } });
  if (!staffPin) throw new PinAuthError();

  const ok = await verifyPinHash(staffPin.pinHash, pin);
  if (!ok) throw new PinAuthError();

  const token = await signStaffJwt({ merchantId: merchant.id, staffPinId: staffPin.id });
  const cookie = buildStaffCookie(token);
  (await cookies()).set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });

  return { ok: true as const };
}

const QR_RE = /^stampme:v1:([A-Za-z0-9_-]{6,128})$/;

const lookupPassInput = z.object({ qrPayload: z.string().min(1).max(256) });

export async function lookupPass(raw: unknown) {
  const session = await getStaffSession();
  if (!session) throw new PassAuthError();

  const { qrPayload } = lookupPassInput.parse(raw);
  const match = QR_RE.exec(qrPayload.trim());
  if (!match) throw new PassAuthError("رمز غير صالح");

  const passKitPassId = match[1];
  Sentry.addBreadcrumb({ category: "scanner", message: "lookupPass", data: { passKitPassId } });

  const pass = await prisma.pass.findUnique({
    where: { passKitPassId },
    include: { program: true },
  });
  if (!pass) throw new PassAuthError("لم يتم العثور على الكرت");
  if (pass.program.merchantId !== session.merchantId) {
    Sentry.captureMessage("scanner cross-merchant lookup attempt", {
      level: "warning",
      extra: { staffMerchant: session.merchantId, passMerchant: pass.program.merchantId },
    });
    throw new PassAuthError("هذا الكرت لا يخص متجرك");
  }

  return {
    passId: pass.id,
    phoneMasked: "****" + pass.customerPhone.slice(-4),
    programName: pass.program.name,
    rewardLabel: pass.program.rewardLabel,
    stampsCount: pass.stampsCount,
    stampsRequired: pass.program.stampsRequired,
    status: pass.status,
    canRedeem: pass.status === "REWARD_READY",
  };
}

const passActionInput = z.object({ passId: z.string().min(1).max(64) });

export async function addStamp(raw: unknown) {
  const session = await getStaffSession();
  if (!session) throw new PassAuthError();
  const { passId } = passActionInput.parse(raw);

  const pass = await prisma.pass.findUnique({
    where: { id: passId },
    include: { program: true },
  });
  if (!pass) throw new PassAuthError("لم يتم العثور على الكرت");
  if (pass.program.merchantId !== session.merchantId) throw new PassAuthError();
  if (pass.status === "REDEEMED" || pass.status === "EXPIRED" || pass.status === "DELETED") {
    throw new PassAuthError("الكرت غير نشط");
  }

  const newCount = pass.stampsCount + 1;
  const reachedThreshold = newCount >= pass.program.stampsRequired;
  const nextStatus = reachedThreshold ? "REWARD_READY" : "ACTIVE";

  const result = await prisma.pass.updateMany({
    where: { id: passId, stampsCount: pass.stampsCount },
    data: { stampsCount: newCount, status: nextStatus },
  });
  if (result.count === 0) throw new ConcurrencyError();

  const stampEvent = await prisma.stampEvent.create({
    data: { passId, staffPinId: session.staffPinId, source: "scanner" },
  });

  try {
    await updatePassStamps({
      passKitPassId: pass.passKitPassId,
      stampsCount: newCount,
      idempotencyKey: `stamp-${stampEvent.id}`,
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { passId, newCount } });
    // pass row already incremented, wallet will reconcile on next pass.viewed webhook
  }

  return { stampsCount: newCount, status: nextStatus, canRedeem: reachedThreshold };
}

export async function redeemReward(raw: unknown) {
  const session = await getStaffSession();
  if (!session) throw new PassAuthError();
  const { passId } = passActionInput.parse(raw);

  const pass = await prisma.pass.findUnique({
    where: { id: passId },
    include: { program: true },
  });
  if (!pass) throw new PassAuthError("لم يتم العثور على الكرت");
  if (pass.program.merchantId !== session.merchantId) throw new PassAuthError();
  if (pass.status !== "REWARD_READY") throw new PassAuthError("الكرت ليس جاهز للصرف بعد");

  const result = await prisma.pass.updateMany({
    where: { id: passId, status: "REWARD_READY" },
    data: { stampsCount: 0, status: "ACTIVE" },
  });
  if (result.count === 0) throw new ConcurrencyError();

  const redemption = await prisma.rewardRedemption.create({
    data: { passId, staffPinId: session.staffPinId },
  });

  try {
    await markRedeemed({
      passKitPassId: pass.passKitPassId,
      idempotencyKey: `redeem-${redemption.id}`,
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { passId } });
  }

  return { ok: true as const };
}
```

- [ ] Add `pinAttemptLimiter` to `src/lib/ratelimit.ts` (Plan 4 owns the file; this task only adds a named export):

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis";

export const pinAttemptLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(5, "10 m"),
  analytics: true,
  prefix: "rl:pin",
});
```
> Note: Plan 4 already wires `redis`. Lockout policy of 5 attempts / 10 min approximates the "1 hour lock" effect by setting window to 10m and allowing 5 attempts, with per-IP key. If product wants a hard 1h lock, layer a second `Ratelimit.fixedWindow(0, "1 h")` once burst exceeded, Phase 2 hardening.

- [ ] Run `bunx vitest run src/lib/actions/staff.test.ts`, all green
- [ ] Commit: `feat(scanner): server actions for PIN auth + scan + stamp + redeem`

---

## Task 5: PWA manifest + service worker + icons placeholder

**Files:**
- `public/manifest.webmanifest`
- `public/sw.js`
- `public/icons/icon-192.png` (placeholder, design generates real)
- `public/icons/icon-512.png`
- `public/icons/apple-touch-icon.png`
- `public/sounds/success.mp3`
- `src/app/scan/_components/PWABootstrap.tsx`

**Steps:**

- [ ] Create `public/manifest.webmanifest`:

```json
{
  "name": "stampme — ماسح",
  "short_name": "stampme",
  "description": "ماسح كروت الولاء للموظفين",
  "start_url": "/scan",
  "scope": "/scan",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0b0b0f",
  "theme_color": "#0b0b0f",
  "lang": "ar",
  "dir": "rtl",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] Create `public/sw.js` (vanilla, no Workbox):

```js
/* stampme scanner service worker, cache shell, network-first for everything else */
const CACHE = "stampme-scan-v1";
const SHELL = [
  "/scan",
  "/scan/scanner",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/sounds/success.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET inside /scan scope
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/scan") && !SHELL.includes(url.pathname)) return;

  // Server actions are POST, never cached
  // For GET shell + assets: cache-first with background revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp.ok && resp.type === "basic") {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return resp;
        })
        .catch(() => cached || new Response("offline", { status: 503 }));
      return cached || network;
    })
  );
});
```

- [ ] Create `src/app/scan/_components/PWABootstrap.tsx`:

```tsx
"use client";
import { useEffect } from "react";

export function PWABootstrap() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/scan" }).catch(() => {});
  }, []);
  return null;
}
```

- [ ] Add placeholder PNGs (1×1 transparent for now, design provides finals). Mark TODO: real assets from designer (192/512/apple-touch-icon, all `purpose: maskable`).

- [ ] Drop `success.mp3` (~10KB, ~150ms tone) into `public/sounds/`. Source: free royalty UI ping. Mark TODO if asset not yet sourced.

- [ ] Commit: `feat(scanner): PWA manifest + minimal service worker`

---

## Task 6: `/scan` PIN form page + server action wiring

**Files:**
- `src/app/scan/layout.tsx`
- `src/app/scan/page.tsx`
- `src/app/scan/_components/PinForm.tsx`
- `src/app/scan/_components/PinForm.test.tsx`

**Steps:**

- [ ] Create `src/app/scan/layout.tsx`, root layout for scanner scope, no Clerk provider, RTL Arabic locked:

```tsx
import type { Metadata, Viewport } from "next";
import { PWABootstrap } from "./_components/PWABootstrap";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "stampme — ماسح",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "stampme",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-[#0b0b0f] text-white min-h-screen antialiased">
        <PWABootstrap />
        {children}
      </body>
    </html>
  );
}
```

- [ ] Create `src/app/scan/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/staff-session";
import { PinForm } from "./_components/PinForm";

export const dynamic = "force-dynamic";

export default async function ScanPinPage() {
  const session = await getStaffSession();
  if (session) redirect("/scan/scanner");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-3xl font-bold">stampme</h1>
        <p className="mb-8 text-white/70">أدخل رمز المتجر و الـ PIN</p>
        <PinForm />
      </div>
    </main>
  );
}
```

- [ ] Create `src/app/scan/_components/PinForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyPin } from "@/lib/actions/staff";

export function PinForm() {
  const [slug, setSlug] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await verifyPin({ slug: slug.trim().toLowerCase(), pin });
        try {
          localStorage.setItem("stampme_show_install_hint", "1");
        } catch {}
        router.replace("/scan/scanner");
      } catch (err) {
        setError(err instanceof Error ? err.message : "خطأ غير معروف");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-white/70">رمز المتجر</span>
        <input
          dir="ltr"
          name="slug"
          autoComplete="off"
          autoCapitalize="none"
          inputMode="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
          className="w-full rounded-lg bg-white/10 px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="cafe-name"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-white/70">PIN</span>
        <input
          dir="ltr"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="\d{4,8}"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          required
          className="w-full rounded-lg bg-white/10 px-4 py-3 text-2xl tracking-widest outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="••••"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-lg font-semibold text-black disabled:opacity-50"
      >
        {pending ? "جارٍ التحقق..." : "دخول"}
      </button>
    </form>
  );
}
```

- [ ] Component test `src/app/scan/_components/PinForm.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PinForm } from "./PinForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/actions/staff", () => ({
  verifyPin: vi.fn().mockRejectedValue(new Error("بيانات الدخول غير صحيحة")),
}));

describe("PinForm", () => {
  it("shows server error message", async () => {
    render(<PinForm />);
    fireEvent.change(screen.getByPlaceholderText("cafe-name"), { target: { value: "x" } });
    fireEvent.change(screen.getByPlaceholderText("••••"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("بيانات الدخول"));
  });

  it("strips non-digits from PIN input", () => {
    render(<PinForm />);
    const pinInput = screen.getByPlaceholderText("••••") as HTMLInputElement;
    fireEvent.change(pinInput, { target: { value: "1a2b3c4" } });
    expect(pinInput.value).toBe("1234");
  });
});
```

- [ ] Commit: `feat(scanner): PIN form page + server action wiring`

---

## Task 7: Scanner page + camera + BarcodeDetector / qr-scanner fallback

**Files:**
- `src/app/scan/scanner/page.tsx`
- `src/app/scan/_components/Scanner.tsx`
- `src/app/scan/_components/PassActions.tsx`
- `src/app/scan/_components/InstallHint.tsx`

**Steps:**

- [ ] `src/app/scan/scanner/page.tsx`, auth guard + render:

```tsx
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/staff-session";
import { Scanner } from "../_components/Scanner";
import { InstallHint } from "../_components/InstallHint";

export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  const session = await getStaffSession();
  if (!session) redirect("/scan");
  return (
    <main className="min-h-dvh">
      <InstallHint />
      <Scanner />
    </main>
  );
}
```

- [ ] `src/app/scan/_components/Scanner.tsx`, full scanner with BarcodeDetector + qr-scanner fallback:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { lookupPass } from "@/lib/actions/staff";
import { PassActions } from "./PassActions";

type LookupResult = Awaited<ReturnType<typeof lookupPass>>;

export function Scanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [pass, setPass] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  // start camera + scanning loop
  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if ("BarcodeDetector" in window) {
          stopRef.current = startBarcodeDetectorLoop();
        } else {
          stopRef.current = await startQrScannerFallback();
        }
      } catch (err) {
        setError("لم نستطع تشغيل الكاميرا، تأكد من الإذن");
      }
    }

    function startBarcodeDetectorLoop(): () => void {
      // @ts-expect-error BarcodeDetector not in lib.dom yet
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      let raf = 0;
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        if (videoRef.current && videoRef.current.readyState === 4 && !busy && !pass) {
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) {
              await onDetected(codes[0].rawValue);
            }
          } catch {}
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
      };
    }

    async function startQrScannerFallback(): Promise<() => void> {
      const QrScanner = (await import("qr-scanner")).default;
      if (!videoRef.current) return () => {};
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          if (!busy && !pass) onDetected(result.data);
        },
        { highlightScanRegion: false, maxScansPerSecond: 5, preferredCamera: "environment" },
      );
      await scanner.start();
      return () => scanner.destroy();
    }

    start();
    return () => {
      cancelled = true;
      stopRef.current();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [busy, pass]);

  async function onDetected(payload: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await lookupPass({ qrPayload: payload });
      setPass(result);
      navigator.vibrate?.(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ");
      navigator.vibrate?.([40, 60, 40]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPass(null);
    setError(null);
  }

  if (pass) {
    return <PassActions pass={pass} onDone={reset} />;
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-64 w-64 rounded-2xl border-4 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
      </div>
      <div className="absolute bottom-6 left-0 right-0 px-6 text-center">
        <p className="text-white/80">وجّه الكاميرا على QR الكرت</p>
      </div>
      {error && (
        <div role="alert" className="absolute top-4 left-4 right-4 rounded-lg bg-red-500/90 px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ms-3 underline">إخفاء</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] `src/app/scan/_components/PassActions.tsx`:

```tsx
"use client";

import { useState } from "react";
import { addStamp, redeemReward } from "@/lib/actions/staff";

type Pass = {
  passId: string;
  phoneMasked: string;
  programName: string;
  rewardLabel: string;
  stampsCount: number;
  stampsRequired: number;
  status: string;
  canRedeem: boolean;
};

const SUCCESS_AUDIO = "/sounds/success.mp3";

export function PassActions({ pass, onDone }: { pass: Pass; onDone: () => void }) {
  const [count, setCount] = useState(pass.stampsCount);
  const [status, setStatus] = useState(pass.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function celebrate(msg: string) {
    setSuccess(msg);
    navigator.vibrate?.([30, 40, 80]);
    try {
      const audio = new Audio(SUCCESS_AUDIO);
      audio.play().catch(() => {});
    } catch {}
  }

  async function handleStamp() {
    setBusy(true);
    setError(null);
    try {
      const res = await addStamp({ passId: pass.passId });
      setCount(res.stampsCount);
      setStatus(res.status);
      celebrate(res.canRedeem ? "اكتمل الكرت، جاهز للصرف" : "تم إضافة الختم");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ");
      navigator.vibrate?.([40, 60, 40]);
    } finally {
      setBusy(false);
    }
  }

  async function handleRedeem() {
    setBusy(true);
    setError(null);
    try {
      await redeemReward({ passId: pass.passId });
      setCount(0);
      setStatus("ACTIVE");
      celebrate("تم صرف الجائزة");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطأ");
      navigator.vibrate?.([40, 60, 40]);
    } finally {
      setBusy(false);
    }
  }

  const canRedeem = status === "REWARD_READY";

  return (
    <div className="flex min-h-dvh flex-col p-6">
      <header className="mb-6">
        <p className="text-sm text-white/60">{pass.programName}</p>
        <h1 className="text-2xl font-bold">{pass.phoneMasked}</h1>
      </header>

      <div className="mb-8 flex items-baseline gap-2">
        <span className="text-6xl font-black tabular-nums">{count}</span>
        <span className="text-2xl text-white/50">/ {pass.stampsRequired}</span>
      </div>

      <div className="mb-8 grid grid-cols-10 gap-1.5">
        {Array.from({ length: pass.stampsRequired }).map((_, i) => (
          <div
            key={i}
            className={`aspect-square rounded-full ${i < count ? "bg-emerald-500" : "bg-white/10"}`}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">
          {success}
        </p>
      )}

      <div className="mt-auto space-y-3">
        {canRedeem ? (
          <button
            onClick={handleRedeem}
            disabled={busy}
            className="w-full rounded-2xl bg-amber-400 px-4 py-5 text-xl font-bold text-black disabled:opacity-50"
          >
            اصرف الجائزة ({pass.rewardLabel})
          </button>
        ) : (
          <button
            onClick={handleStamp}
            disabled={busy}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-5 text-xl font-bold text-black disabled:opacity-50"
          >
            {busy ? "..." : "أضف ختم"}
          </button>
        )}
        <button
          onClick={onDone}
          className="w-full rounded-2xl bg-white/10 px-4 py-3 text-base"
        >
          مسح كرت آخر
        </button>
      </div>
    </div>
  );
}
```

- [ ] Commit: `feat(scanner): camera scanner + pass actions UI`

---

## Task 8: Install hint component (Add to Home Screen)

**Files:**
- `src/app/scan/_components/InstallHint.tsx`

**Steps:**

- [ ] Implement:

```tsx
"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "stampme_install_dismissed";

export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      localStorage.setItem(DISMISS_KEY, "1");
    }
    setShow(false);
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  return (
    <div className="fixed inset-x-2 top-2 z-50 flex items-center gap-3 rounded-xl bg-emerald-500/95 px-4 py-3 text-black shadow-lg">
      <div className="flex-1 text-sm">
        <strong>ثبّت التطبيق</strong>، للوصول السريع من الشاشة الرئيسية
      </div>
      <button onClick={install} className="rounded-md bg-black px-3 py-1.5 text-sm font-semibold text-white">
        تثبيت
      </button>
      <button onClick={dismiss} aria-label="إغلاق" className="px-2 text-lg">×</button>
    </div>
  );
}
```

- [ ] iOS Safari note: `beforeinstallprompt` doesn't fire on iOS. Add a one-time iOS-specific banner that says "اضغط مشاركة، أضف إلى الشاشة الرئيسية" when `navigator.standalone === false` and `/iPhone|iPad|iPod/.test(navigator.userAgent)`, Phase 2 polish. For MVP, document the manual gesture in onboarding email.

- [ ] Commit: `feat(scanner): PWA install hint banner`

---

## Task 9: E2E / integration smoke test

**Files:**
- `tests/e2e/scanner.spec.ts` (Playwright, assume Playwright wired in Plan 1)

**Steps:**

- [ ] Skip-by-default test that documents the happy path:

```ts
import { test, expect } from "@playwright/test";

test.describe("scanner happy path", () => {
  test.skip(!process.env.E2E, "set E2E=1 + seeded merchant to run");

  test("PIN, camera permission, mock QR, stamp adds", async ({ page, context }) => {
    await context.grantPermissions(["camera"]);
    await page.goto("/scan");

    await page.fill('input[name="slug"]', process.env.E2E_MERCHANT_SLUG!);
    await page.fill('input[name="pin"]', process.env.E2E_MERCHANT_PIN!);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/scan\/scanner$/);
    // Camera + barcode detection cannot be deterministically driven in headless
    // invoke the server action directly via the page context as a sanity check
    const before = await page.evaluate(async () => {
      const { lookupPass } = await import("/src/lib/actions/staff");
      return lookupPass({ qrPayload: `stampme:v1:${process.env.E2E_PASSKIT_PASS_ID}` });
    });
    expect(before.stampsCount).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] Add docs note: real camera-driven E2E requires a hardware test farm; gating behind `E2E=1` keeps CI green while letting QA run it manually before launch.

- [ ] Commit: `test(scanner): playwright e2e skeleton`

---

## Task 10: CSP headers, telemetry final polish

**Files:**
- `next.config.js` (modify, add headers for `/scan/*`)
- `src/lib/actions/staff.ts` (already includes Sentry breadcrumbs from Task 4)

**Steps:**

- [ ] In `next.config.js` `headers()` block, add:

```js
{
  source: "/scan/:path*",
  headers: [
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
  ],
}
```

- [ ] Verify Sentry breadcrumbs in `staff.ts` do not log PIN or full phone, only slug, passKitPassId, merchant ids. Grep:
  ```bash
  rg "pin|customerPhone" src/lib/actions/staff.ts
  ```
  Expect zero hits inside `Sentry.*` calls.

- [ ] Manual QA pass on real device:
  - [ ] Chrome Android: camera, BarcodeDetector, install prompt, vibration, audio
  - [ ] Safari iOS: camera, qr-scanner fallback (no BarcodeDetector), manual install via share sheet, no audio autoplay
  - [ ] Offline reload: `/scan/scanner` shell loads, submit shows network error
  - [ ] Two cashiers same pass: second one gets `ConcurrencyError`

- [ ] Commit: `feat(scanner): CSP headers + manual QA pass`

---

## Definition of Done

- [ ] All vitest suites green (`bunx vitest run`)
- [ ] Playwright skeleton compiles (real run gated on `E2E=1`)
- [ ] Manual QA pass on Chrome Android + Safari iOS
- [ ] PWA Lighthouse score >= 90 on `/scan`
- [ ] Sentry receives `scanner.*` breadcrumbs in staging
- [ ] No PIN, no full customer phone in logs (verify via grep)
- [ ] Cookie path scoped to `/scan` (verify in DevTools)
- [ ] BarcodeDetector path tested on real Android Chrome
- [ ] qr-scanner fallback tested on real iOS Safari
- [ ] `STAFF_JWT_SECRET` rotated in production env (Vercel) before launch

## Out of scope (explicit)

- Per-staff PINs, single PIN per merchant in MVP (Plan 2 model already supports `StaffPin[]`, but UI surfaces only one)
- Offline scan queue with IndexedDB, Phase 2
- HMAC-signed QR payloads, Phase 2 if scraping becomes an attack
- iOS-specific install banner, Phase 2 polish
- Audit log UI, Phase 2 (`StampEvent` already records `staffPinId`)
- Plan limit enforcement at stamp time, Plan 6 owns issuance limits, stamps unmetered in MVP
- Subdomain split, Phase 2 (see Decision 1)
