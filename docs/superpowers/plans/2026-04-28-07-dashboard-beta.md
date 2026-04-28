# stampme — Plan 7: Merchant Dashboard & Beta Launch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the product with a usable merchant dashboard (KPIs, trends, funnel, activity, plan usage), wire production observability (PostHog events, Sentry SLOs), enforce performance budgets, run pre-launch QA checklist, and onboard 5 beta cafes.

**Architecture:** Dashboard SSRs aggregations from Postgres (cached 5 min). PostHog events emitted from server actions. Sentry tracks releases per Vercel deploy. CI gates lint+typecheck+test+build+bundle+Lighthouse. Beta onboarding is in-person, documented in runbooks.

**Tech Stack:** Next.js 15, recharts, Prisma `groupBy`, `unstable_cache`, PostHog, Sentry, GitHub Actions, Lighthouse CI, Husky

**Depends on:** Plans 1-6

**Spec reference:** `docs/superpowers/specs/2026-04-28-stampme-design.md` §١٠, §١١

---

## Task 1 — Dependencies, Prisma indexes, migration

**Files:**
- `package.json`
- `prisma/schema.prisma` (modify)
- `prisma/migrations/<ts>_dashboard_indexes/migration.sql`

**Steps:**

- [ ] Install runtime + dev deps:
  ```bash
  bun add recharts date-fns
  bun add -d @next/bundle-analyzer husky lint-staged @lhci/cli @faker-js/faker
  ```
- [ ] Add indexes to `prisma/schema.prisma` on the two tables we aggregate against. Edit the existing models (defined in Plan 1) — do NOT recreate fields, only add `@@index` lines:
  ```prisma
  model Pass {
    // ...existing fields from Plan 1...
    @@index([programId, customerPhone])
    @@index([programId, createdAt])
    @@index([createdAt])
  }

  model StampEvent {
    // ...existing fields from Plan 1...
    @@index([passId, createdAt])
    @@index([createdAt])
  }

  model RewardRedemption {
    // ...existing fields from Plan 1...
    @@index([passId, redeemedAt])
    @@index([redeemedAt])
  }
  ```
- [ ] Generate the migration:
  ```bash
  bunx prisma migrate dev --name dashboard_indexes
  ```
- [ ] Verify the SQL produces `CREATE INDEX` statements (not table re-creates). Expected snippet inside the generated `migration.sql`:
  ```sql
  CREATE INDEX "Pass_programId_createdAt_idx" ON "Pass"("programId", "createdAt");
  CREATE INDEX "Pass_createdAt_idx" ON "Pass"("createdAt");
  CREATE INDEX "StampEvent_passId_createdAt_idx" ON "StampEvent"("passId", "createdAt");
  CREATE INDEX "StampEvent_createdAt_idx" ON "StampEvent"("createdAt");
  CREATE INDEX "RewardRedemption_passId_redeemedAt_idx" ON "RewardRedemption"("passId", "redeemedAt");
  CREATE INDEX "RewardRedemption_redeemedAt_idx" ON "RewardRedemption"("redeemedAt");
  ```
- [ ] Run `bunx prisma generate` to refresh the client.
- [ ] Commit: `chore(db): add createdAt indexes for dashboard aggregations`

---

## Task 2 — PostHog event registry (single source of truth)

**Files:**
- `src/lib/posthog/events.ts`
- `src/lib/posthog/server.ts` (modify — exists from Plan 1)
- `src/lib/posthog/client.ts` (modify — exists from Plan 1)
- `tests/lib/posthog/events.test.ts`

**Why:** Tracking events as freeform strings is the #1 cause of broken funnels in production — typos compound silently. We force every emitter (server + client) through a typed registry, and a test that asserts the union matches the runtime const.

**Steps:**

- [ ] Write `tests/lib/posthog/events.test.ts` first (TDD):
  ```ts
  import { describe, it, expect } from "vitest";
  import { EVENTS, type EventName, eventNames } from "@/lib/posthog/events";

  describe("PostHog event registry", () => {
    it("exposes a frozen object", () => {
      expect(Object.isFrozen(EVENTS)).toBe(true);
    });

    it("uses snake_case event names", () => {
      for (const name of eventNames) {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it("type EventName is the union of values", () => {
      // Compile-time check: assignable both ways.
      const sample: EventName = EVENTS.MERCHANT_SIGNED_UP;
      expect(sample).toBe("merchant_signed_up");
    });

    it("contains all required Phase-1 events", () => {
      const required = [
        "merchant_signed_up",
        "onboarding_completed",
        "card_designed",
        "pass_issued",
        "stamp_added",
        "reward_redeemed",
        "subscription_started",
        "subscription_canceled",
      ];
      for (const r of required) {
        expect(eventNames).toContain(r);
      }
    });
  });
  ```
- [ ] Run the test — expect it to fail (`Cannot find module '@/lib/posthog/events'`).
- [ ] Create `src/lib/posthog/events.ts`:
  ```ts
  /**
   * Single source of truth for analytics event names.
   * Add an event here BEFORE calling `track()` anywhere in the codebase.
   * The PostHog dashboards/funnels reference these exact strings.
   */
  export const EVENTS = Object.freeze({
    // Merchant lifecycle
    MERCHANT_SIGNED_UP: "merchant_signed_up",
    ONBOARDING_STARTED: "onboarding_started",
    ONBOARDING_COMPLETED: "onboarding_completed",
    CARD_DESIGNED: "card_designed",

    // Pass lifecycle
    PASS_ISSUED: "pass_issued",
    PASS_INSTALLED: "pass_installed",
    PASS_REMOVED: "pass_removed",

    // Engagement
    STAMP_ADDED: "stamp_added",
    REWARD_EARNED: "reward_earned",
    REWARD_REDEEMED: "reward_redeemed",

    // Billing
    SUBSCRIPTION_STARTED: "subscription_started",
    SUBSCRIPTION_RENEWED: "subscription_renewed",
    SUBSCRIPTION_CANCELED: "subscription_canceled",
    PAYMENT_FAILED: "payment_failed",

    // UI (browser)
    CTA_CLICKED: "cta_clicked",
    PAGE_VIEWED: "page_viewed",
  } as const);

  export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

  export const eventNames: ReadonlyArray<EventName> = Object.values(EVENTS);

  /** Per-event property contracts. Extend as the schema grows. */
  export interface EventProps {
    merchant_signed_up: { merchantId: string; vertical: string; locale: "ar" | "en" };
    onboarding_started: { merchantId: string };
    onboarding_completed: { merchantId: string; durationMs: number };
    card_designed: { merchantId: string; programId: string; stampsRequired: number };
    pass_issued: { merchantId: string; programId: string; passId: string; channel: "qr" | "link" };
    pass_installed: { merchantId: string; passId: string; platform: "apple" | "google" };
    pass_removed: { merchantId: string; passId: string };
    stamp_added: { merchantId: string; passId: string; staffPinId: string; stampsCount: number };
    reward_earned: { merchantId: string; passId: string };
    reward_redeemed: { merchantId: string; passId: string; staffPinId: string };
    subscription_started: { merchantId: string; plan: "STARTER" | "GROWTH" | "PRO"; amountSar: number };
    subscription_renewed: { merchantId: string; plan: string; amountSar: number };
    subscription_canceled: { merchantId: string; reason?: string };
    payment_failed: { merchantId: string; reason: string };
    cta_clicked: { id: string; locale: "ar" | "en" };
    page_viewed: { path: string; locale: "ar" | "en" };
  }
  ```
- [ ] Re-run test — green.
- [ ] Modify `src/lib/posthog/server.ts` (created in Plan 1) so its `track()` is now generic and bound to the registry:
  ```ts
  import { PostHog } from "posthog-node";
  import type { EventName, EventProps } from "./events";

  let _client: PostHog | null = null;

  function client(): PostHog {
    if (_client) return _client;
    _client = new PostHog(process.env.POSTHOG_API_KEY!, {
      host: process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com",
      flushAt: 1,
      flushInterval: 0, // serverless-friendly
    });
    return _client;
  }

  export async function track<E extends EventName>(args: {
    distinctId: string;
    event: E;
    properties: E extends keyof EventProps ? EventProps[E] : Record<string, unknown>;
  }): Promise<void> {
    try {
      client().capture({
        distinctId: args.distinctId,
        event: args.event,
        properties: args.properties as Record<string, unknown>,
      });
      await client().flush();
    } catch (err) {
      // Never let analytics break a server action.
      console.error("[posthog] track failed", { event: args.event, err });
    }
  }

  export async function identifyMerchant(args: {
    clerkUserId: string;
    merchantId: string;
    email: string;
    vertical: string;
  }): Promise<void> {
    try {
      client().identify({
        distinctId: args.clerkUserId,
        properties: {
          merchantId: args.merchantId,
          email: args.email,
          vertical: args.vertical,
        },
      });
      await client().flush();
    } catch (err) {
      console.error("[posthog] identify failed", err);
    }
  }
  ```
- [ ] Modify `src/lib/posthog/client.ts` for browser:
  ```ts
  "use client";
  import posthog from "posthog-js";
  import type { EventName, EventProps } from "./events";

  let initialized = false;

  export function initPostHog(): void {
    if (initialized || typeof window === "undefined") return;
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false, // we emit page_viewed manually with locale tag
      autocapture: false,
    });
    initialized = true;
  }

  export function trackClient<E extends EventName>(
    event: E,
    properties: E extends keyof EventProps ? EventProps[E] : Record<string, unknown>,
  ): void {
    if (!initialized) return;
    posthog.capture(event, properties as Record<string, unknown>);
  }

  export function aliasOnSignup(clerkUserId: string): void {
    if (!initialized) return;
    posthog.alias(clerkUserId);
  }
  ```
- [ ] Commit: `feat(analytics): typed PostHog event registry`

---

## Task 3 — Sprinkle PostHog `track()` into existing server actions

**Why:** Plans 1-6 wrote the actions but left analytics out (rightly — keep them focused). Now we wire them up explicitly.

**Files (all modified, NOT created):**
- `src/lib/actions/onboarding.ts`
- `src/lib/actions/syncProgram.ts`
- `src/lib/actions/enrollment.ts`
- `src/lib/actions/staff.ts`
- `src/lib/actions/hyperpay/checkout.ts`
- `src/lib/actions/hyperpay/webhook.ts`

**Steps:**

- [ ] In `src/lib/actions/onboarding.ts` — at the end of the success path of `completeOnboarding()`:
  ```ts
  import { track, identifyMerchant } from "@/lib/posthog/server";
  import { EVENTS } from "@/lib/posthog/events";

  // ...inside completeOnboarding(), after Merchant row is updated with vertical/logo/color:
  await identifyMerchant({
    clerkUserId: session.userId,
    merchantId: merchant.id,
    email: merchant.ownerEmail,
    vertical: merchant.vertical,
  });
  await track({
    distinctId: session.userId,
    event: EVENTS.ONBOARDING_COMPLETED,
    properties: {
      merchantId: merchant.id,
      durationMs: Date.now() - new Date(merchant.createdAt).getTime(),
    },
  });
  ```
  Also add `MERCHANT_SIGNED_UP` in the Clerk webhook handler (`src/app/api/webhooks/clerk/route.ts` — created in Plan 1):
  ```ts
  await track({
    distinctId: clerkUserId,
    event: EVENTS.MERCHANT_SIGNED_UP,
    properties: { merchantId: merchant.id, vertical: merchant.vertical, locale },
  });
  ```
- [ ] In `src/lib/actions/syncProgram.ts` — after PassKit `PUT /programs/{id}/templates` succeeds:
  ```ts
  await track({
    distinctId: session.userId,
    event: EVENTS.CARD_DESIGNED,
    properties: { merchantId, programId: program.id, stampsRequired: input.stampsRequired },
  });
  ```
- [ ] In `src/lib/actions/enrollment.ts` — after `Pass` row is created and PassKit returns `passKitPassId`:
  ```ts
  await track({
    distinctId: pass.id, // anonymous customer; merchantId in properties
    event: EVENTS.PASS_ISSUED,
    properties: { merchantId, programId, passId: pass.id, channel: input.channel },
  });
  ```
  Note: customer has no Clerk user — distinctId is the pass id; PostHog person profile is implicit.
- [ ] In `src/lib/actions/staff.ts` — both `addStamp()` and `redeemReward()`:
  ```ts
  // addStamp
  await track({
    distinctId: pass.id,
    event: EVENTS.STAMP_ADDED,
    properties: { merchantId, passId: pass.id, staffPinId, stampsCount: pass.stampsCount + 1 },
  });
  if (pass.stampsCount + 1 >= program.stampsRequired) {
    await track({
      distinctId: pass.id,
      event: EVENTS.REWARD_EARNED,
      properties: { merchantId, passId: pass.id },
    });
  }

  // redeemReward
  await track({
    distinctId: pass.id,
    event: EVENTS.REWARD_REDEEMED,
    properties: { merchantId, passId: pass.id, staffPinId },
  });
  ```
- [ ] In `src/lib/actions/hyperpay/checkout.ts` — after `Subscription` row goes ACTIVE:
  ```ts
  await track({
    distinctId: session.userId,
    event: EVENTS.SUBSCRIPTION_STARTED,
    properties: { merchantId, plan, amountSar: PLAN_PRICES_SAR[plan] },
  });
  ```
- [ ] In `src/lib/actions/hyperpay/webhook.ts`:
  - On renewal: `EVENTS.SUBSCRIPTION_RENEWED`
  - On `payment.failed`: `EVENTS.PAYMENT_FAILED`
  - On cancellation: `EVENTS.SUBSCRIPTION_CANCELED`
- [ ] In `src/app/api/webhooks/passkit/route.ts` (Plan 3) — `pass.installed` and `pass.removed` events.
- [ ] Commit: `feat(analytics): emit lifecycle events from server actions`

---

## Task 4 — Aggregation queries (TDD)

**Files:**
- `tests/factories/index.ts`
- `tests/factories/merchant.ts`
- `tests/factories/program.ts`
- `tests/factories/pass.ts`
- `tests/factories/stampEvent.ts`
- `tests/factories/redemption.ts`
- `tests/lib/analytics/queries.test.ts`
- `src/lib/analytics/queries.ts`

**Steps:**

- [ ] Create `tests/factories/index.ts` re-exports:
  ```ts
  export * from "./merchant";
  export * from "./program";
  export * from "./pass";
  export * from "./stampEvent";
  export * from "./redemption";
  ```
- [ ] `tests/factories/merchant.ts`:
  ```ts
  import { faker } from "@faker-js/faker";
  import { prisma } from "@/lib/prisma";
  import type { Merchant, Vertical } from "@prisma/client";

  export async function makeMerchant(overrides: Partial<Merchant> = {}): Promise<Merchant> {
    return prisma.merchant.create({
      data: {
        name: overrides.name ?? faker.company.name(),
        ownerEmail: overrides.ownerEmail ?? faker.internet.email(),
        ownerPhone: overrides.ownerPhone ?? "+9665" + faker.string.numeric(8),
        clerkUserId: overrides.clerkUserId ?? `user_${faker.string.alphanumeric(20)}`,
        vertical: (overrides.vertical ?? "CAFE") as Vertical,
        brandColor: overrides.brandColor ?? "#0A7B5F",
        logoUrl: overrides.logoUrl ?? null,
      },
    });
  }
  ```
- [ ] `tests/factories/program.ts`:
  ```ts
  import { faker } from "@faker-js/faker";
  import { prisma } from "@/lib/prisma";
  import type { LoyaltyProgram } from "@prisma/client";

  export async function makeProgram(
    merchantId: string,
    overrides: Partial<LoyaltyProgram> = {},
  ): Promise<LoyaltyProgram> {
    return prisma.loyaltyProgram.create({
      data: {
        merchantId,
        name: overrides.name ?? "Loyalty",
        stampsRequired: overrides.stampsRequired ?? 10,
        rewardLabel: overrides.rewardLabel ?? "قهوة مجّانيّة",
        passKitProgramId: overrides.passKitProgramId ?? `pk_${faker.string.alphanumeric(16)}`,
      },
    });
  }
  ```
- [ ] `tests/factories/pass.ts`:
  ```ts
  import { faker } from "@faker-js/faker";
  import { prisma } from "@/lib/prisma";
  import type { Pass, PassStatus } from "@prisma/client";

  export async function makePass(
    programId: string,
    overrides: Partial<Pass> = {},
  ): Promise<Pass> {
    return prisma.pass.create({
      data: {
        programId,
        customerPhone: overrides.customerPhone ?? "+9665" + faker.string.numeric(8),
        passKitPassId: overrides.passKitPassId ?? `pkpass_${faker.string.alphanumeric(20)}`,
        stampsCount: overrides.stampsCount ?? 0,
        status: (overrides.status ?? "ACTIVE") as PassStatus,
        createdAt: overrides.createdAt ?? new Date(),
      },
    });
  }
  ```
- [ ] `tests/factories/stampEvent.ts`:
  ```ts
  import { prisma } from "@/lib/prisma";
  import type { StampEvent } from "@prisma/client";

  export async function makeStampEvent(
    passId: string,
    staffPinId: string,
    overrides: Partial<StampEvent> = {},
  ): Promise<StampEvent> {
    return prisma.stampEvent.create({
      data: {
        passId,
        staffPinId,
        source: overrides.source ?? "scanner",
        createdAt: overrides.createdAt ?? new Date(),
      },
    });
  }
  ```
- [ ] `tests/factories/redemption.ts`:
  ```ts
  import { prisma } from "@/lib/prisma";
  import type { RewardRedemption } from "@prisma/client";

  export async function makeRedemption(
    passId: string,
    staffPinId: string,
    overrides: Partial<RewardRedemption> = {},
  ): Promise<RewardRedemption> {
    return prisma.rewardRedemption.create({
      data: {
        passId,
        staffPinId,
        redeemedAt: overrides.redeemedAt ?? new Date(),
      },
    });
  }
  ```
- [ ] Write `tests/lib/analytics/queries.test.ts` (TDD — write before queries.ts):
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { prisma } from "@/lib/prisma";
  import {
    getKpis,
    getStampsTrend,
    getFunnel,
    getRecentActivity,
    getPlanUsage,
  } from "@/lib/analytics/queries";
  import {
    makeMerchant,
    makeProgram,
    makePass,
    makeStampEvent,
    makeRedemption,
  } from "@/tests/factories";

  async function makeStaffPin(merchantId: string) {
    return prisma.staffPin.create({
      data: { merchantId, pinHash: "hash", label: "main" },
    });
  }

  beforeEach(async () => {
    // Order matters because of FK constraints.
    await prisma.rewardRedemption.deleteMany();
    await prisma.stampEvent.deleteMany();
    await prisma.pass.deleteMany();
    await prisma.loyaltyProgram.deleteMany();
    await prisma.staffPin.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.merchant.deleteMany();
  });

  describe("getKpis", () => {
    it("counts passes issued in current period and computes delta", async () => {
      const m = await makeMerchant();
      const p = await makeProgram(m.id);

      const now = new Date("2026-04-28T12:00:00Z");
      const lastWeek = new Date("2026-04-21T12:00:00Z");

      // 5 passes this period
      for (let i = 0; i < 5; i++) await makePass(p.id, { createdAt: now });
      // 2 passes last period
      for (let i = 0; i < 2; i++) await makePass(p.id, { createdAt: lastWeek });

      const kpis = await getKpis(m.id, { now, periodDays: 7 });

      expect(kpis.passesIssued.current).toBe(5);
      expect(kpis.passesIssued.previous).toBe(2);
      expect(kpis.passesIssued.deltaPct).toBeCloseTo(150, 0); // (5-2)/2 = 150%
    });

    it("counts stamps today vs daily average over last 30 days", async () => {
      const m = await makeMerchant();
      const p = await makeProgram(m.id);
      const pass = await makePass(p.id);
      const pin = await makeStaffPin(m.id);

      const now = new Date("2026-04-28T12:00:00Z");
      // 4 stamps today
      for (let i = 0; i < 4; i++) await makeStampEvent(pass.id, pin.id, { createdAt: now });
      // 30 stamps spread over last 30 days = 1/day average
      for (let d = 1; d <= 30; d++) {
        const past = new Date(now);
        past.setDate(past.getDate() - d);
        await makeStampEvent(pass.id, pin.id, { createdAt: past });
      }

      const kpis = await getKpis(m.id, { now, periodDays: 7 });
      expect(kpis.stampsToday.count).toBe(4);
      expect(kpis.stampsToday.dailyAvg30d).toBe(1);
    });

    it("computes redemption rate = redemptions / passes issued", async () => {
      const m = await makeMerchant();
      const p = await makeProgram(m.id);
      const pin = await makeStaffPin(m.id);

      const now = new Date("2026-04-28T12:00:00Z");
      const passes = [];
      for (let i = 0; i < 10; i++) passes.push(await makePass(p.id, { createdAt: now }));
      // 3 redemptions
      for (let i = 0; i < 3; i++) await makeRedemption(passes[i].id, pin.id, { redeemedAt: now });

      const kpis = await getKpis(m.id, { now, periodDays: 7 });
      expect(kpis.rewardsRedeemed.count).toBe(3);
      expect(kpis.rewardsRedeemed.redemptionRatePct).toBeCloseTo(30, 0);
    });
  });

  describe("getStampsTrend", () => {
    it("returns 30 daily buckets ending today, zeros where no events", async () => {
      const m = await makeMerchant();
      const p = await makeProgram(m.id);
      const pass = await makePass(p.id);
      const pin = await makeStaffPin(m.id);

      const now = new Date("2026-04-28T12:00:00Z");
      // 2 stamps 5 days ago
      const fiveDaysAgo = new Date(now);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      await makeStampEvent(pass.id, pin.id, { createdAt: fiveDaysAgo });
      await makeStampEvent(pass.id, pin.id, { createdAt: fiveDaysAgo });

      const trend = await getStampsTrend(m.id, { now, days: 30 });
      expect(trend).toHaveLength(30);
      const day = trend.find((d) => d.date.startsWith("2026-04-23"));
      expect(day?.count).toBe(2);
      const today = trend[trend.length - 1];
      expect(today.date.startsWith("2026-04-28")).toBe(true);
    });
  });

  describe("getFunnel", () => {
    it("computes enrollment → 1st stamp → reward earned → redeemed rates", async () => {
      const m = await makeMerchant();
      const p = await makeProgram(m.id, { stampsRequired: 3 });
      const pin = await makeStaffPin(m.id);

      // 10 enrollments
      const passes = [];
      for (let i = 0; i < 10; i++) passes.push(await makePass(p.id));

      // 7 get a stamp
      for (let i = 0; i < 7; i++) {
        await makeStampEvent(passes[i].id, pin.id);
        await prisma.pass.update({ where: { id: passes[i].id }, data: { stampsCount: 1 } });
      }
      // 4 reach reward (stampsCount >= 3)
      for (let i = 0; i < 4; i++) {
        await prisma.pass.update({ where: { id: passes[i].id }, data: { stampsCount: 3 } });
      }
      // 2 redeem
      for (let i = 0; i < 2; i++) await makeRedemption(passes[i].id, pin.id);

      const funnel = await getFunnel(m.id);
      expect(funnel.enrolled).toBe(10);
      expect(funnel.firstStamp).toBe(7);
      expect(funnel.rewardEarned).toBe(4);
      expect(funnel.redeemed).toBe(2);
    });
  });

  describe("getRecentActivity", () => {
    it("returns last 20 events in DESC order", async () => {
      const m = await makeMerchant();
      const p = await makeProgram(m.id);
      const pass = await makePass(p.id);
      const pin = await makeStaffPin(m.id);

      for (let i = 0; i < 25; i++) {
        await makeStampEvent(pass.id, pin.id, {
          createdAt: new Date(2026, 3, 28, 12, i),
        });
      }
      const activity = await getRecentActivity(m.id);
      expect(activity.length).toBeLessThanOrEqual(20);
      // Newest first
      const ts0 = new Date(activity[0].at).getTime();
      const ts1 = new Date(activity[1].at).getTime();
      expect(ts0).toBeGreaterThanOrEqual(ts1);
    });
  });

  describe("getPlanUsage", () => {
    it("returns passes used / quota with color band", async () => {
      const m = await makeMerchant();
      await prisma.subscription.create({
        data: {
          merchantId: m.id,
          plan: "STARTER",
          status: "ACTIVE",
          currentPeriodEnd: new Date("2026-05-28"),
        },
      });
      const p = await makeProgram(m.id);
      // 250 passes this billing period (Starter quota = 300)
      for (let i = 0; i < 250; i++) await makePass(p.id);

      const usage = await getPlanUsage(m.id);
      expect(usage.used).toBe(250);
      expect(usage.quota).toBe(300);
      expect(usage.band).toBe("yellow"); // 250/300 = 83% > 80%
    });
  });
  ```
- [ ] Run tests — all should fail (`Cannot find module .../queries`).
- [ ] Implement `src/lib/analytics/queries.ts`:
  ```ts
  import "server-only";
  import { prisma } from "@/lib/prisma";

  type Period = { now: Date; periodDays: number };

  function shiftDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + n);
    return r;
  }

  function startOfDayUTC(d: Date): Date {
    const r = new Date(d);
    r.setUTCHours(0, 0, 0, 0);
    return r;
  }

  function pctDelta(current: number, previous: number): number {
    if (previous === 0) return current === 0 ? 0 : 100;
    return ((current - previous) / previous) * 100;
  }

  export interface Kpis {
    passesIssued: { current: number; previous: number; deltaPct: number };
    stampsToday: { count: number; dailyAvg30d: number };
    rewardsRedeemed: { count: number; redemptionRatePct: number };
  }

  export async function getKpis(merchantId: string, p: Period): Promise<Kpis> {
    const periodStart = shiftDays(p.now, -p.periodDays);
    const prevStart = shiftDays(periodStart, -p.periodDays);
    const dayStart = startOfDayUTC(p.now);
    const trendStart = shiftDays(dayStart, -30);

    const programIds = (
      await prisma.loyaltyProgram.findMany({
        where: { merchantId },
        select: { id: true },
      })
    ).map((x) => x.id);

    if (programIds.length === 0) {
      return {
        passesIssued: { current: 0, previous: 0, deltaPct: 0 },
        stampsToday: { count: 0, dailyAvg30d: 0 },
        rewardsRedeemed: { count: 0, redemptionRatePct: 0 },
      };
    }

    const [
      passesCurrent,
      passesPrevious,
      stampsToday,
      stamps30d,
      redemptionsCurrent,
    ] = await Promise.all([
      prisma.pass.count({
        where: { programId: { in: programIds }, createdAt: { gte: periodStart, lte: p.now } },
      }),
      prisma.pass.count({
        where: { programId: { in: programIds }, createdAt: { gte: prevStart, lt: periodStart } },
      }),
      prisma.stampEvent.count({
        where: {
          pass: { programId: { in: programIds } },
          createdAt: { gte: dayStart, lte: p.now },
        },
      }),
      prisma.stampEvent.count({
        where: {
          pass: { programId: { in: programIds } },
          createdAt: { gte: trendStart, lt: dayStart },
        },
      }),
      prisma.rewardRedemption.count({
        where: {
          pass: { programId: { in: programIds } },
          redeemedAt: { gte: periodStart, lte: p.now },
        },
      }),
    ]);

    const dailyAvg30d = Math.round(stamps30d / 30);
    const redemptionRatePct =
      passesCurrent === 0 ? 0 : (redemptionsCurrent / passesCurrent) * 100;

    return {
      passesIssued: {
        current: passesCurrent,
        previous: passesPrevious,
        deltaPct: pctDelta(passesCurrent, passesPrevious),
      },
      stampsToday: { count: stampsToday, dailyAvg30d },
      rewardsRedeemed: { count: redemptionsCurrent, redemptionRatePct },
    };
  }

  export interface TrendPoint {
    date: string; // ISO yyyy-mm-dd
    count: number;
  }

  export async function getStampsTrend(
    merchantId: string,
    opts: { now: Date; days: number },
  ): Promise<TrendPoint[]> {
    const end = startOfDayUTC(opts.now);
    const start = shiftDays(end, -(opts.days - 1));

    const programIds = (
      await prisma.loyaltyProgram.findMany({
        where: { merchantId },
        select: { id: true },
      })
    ).map((x) => x.id);

    if (programIds.length === 0) {
      return Array.from({ length: opts.days }, (_, i) => ({
        date: shiftDays(start, i).toISOString(),
        count: 0,
      }));
    }

    // groupBy on a generated date column isn't supported by Prisma — use $queryRaw.
    const rows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "StampEvent" se
      JOIN "Pass" p ON p.id = se."passId"
      WHERE p."programId" = ANY(${programIds}::text[])
        AND se."createdAt" >= ${start}
        AND se."createdAt" < ${shiftDays(end, 1)}
      GROUP BY day
      ORDER BY day ASC
    `;

    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.day.toISOString().slice(0, 10), Number(r.count));
    }
    return Array.from({ length: opts.days }, (_, i) => {
      const d = shiftDays(start, i);
      const key = d.toISOString().slice(0, 10);
      return { date: d.toISOString(), count: map.get(key) ?? 0 };
    });
  }

  export interface Funnel {
    enrolled: number;
    firstStamp: number;
    rewardEarned: number;
    redeemed: number;
  }

  export async function getFunnel(merchantId: string): Promise<Funnel> {
    const programs = await prisma.loyaltyProgram.findMany({
      where: { merchantId },
      select: { id: true, stampsRequired: true },
    });
    if (programs.length === 0) {
      return { enrolled: 0, firstStamp: 0, rewardEarned: 0, redeemed: 0 };
    }
    const programIds = programs.map((p) => p.id);

    const [enrolled, firstStamp, redeemed, rewardEarnedRows] = await Promise.all([
      prisma.pass.count({ where: { programId: { in: programIds } } }),
      prisma.pass.count({
        where: { programId: { in: programIds }, stampsCount: { gte: 1 } },
      }),
      prisma.rewardRedemption.count({
        where: { pass: { programId: { in: programIds } } },
      }),
      // For "reward earned" we need per-program threshold check.
      Promise.all(
        programs.map((p) =>
          prisma.pass.count({
            where: { programId: p.id, stampsCount: { gte: p.stampsRequired } },
          }),
        ),
      ),
    ]);

    const rewardEarned = (rewardEarnedRows as number[]).reduce((a, b) => a + b, 0);

    return { enrolled, firstStamp, rewardEarned, redeemed };
  }

  export type ActivityKind = "enrollment" | "stamp" | "redemption" | "pass_deleted";
  export interface ActivityItem {
    kind: ActivityKind;
    at: string;
    customerPhoneSuffix: string; // last 4
    meta?: Record<string, string | number>;
  }

  export async function getRecentActivity(merchantId: string): Promise<ActivityItem[]> {
    const programIds = (
      await prisma.loyaltyProgram.findMany({
        where: { merchantId },
        select: { id: true },
      })
    ).map((x) => x.id);

    if (programIds.length === 0) return [];

    const [stamps, redemptions, enrollments, deletions] = await Promise.all([
      prisma.stampEvent.findMany({
        where: { pass: { programId: { in: programIds } } },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { pass: { select: { customerPhone: true, stampsCount: true } } },
      }),
      prisma.rewardRedemption.findMany({
        where: { pass: { programId: { in: programIds } } },
        orderBy: { redeemedAt: "desc" },
        take: 20,
        include: { pass: { select: { customerPhone: true } } },
      }),
      prisma.pass.findMany({
        where: { programId: { in: programIds } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { customerPhone: true, createdAt: true },
      }),
      prisma.pass.findMany({
        where: { programId: { in: programIds }, status: "DELETED" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { customerPhone: true, createdAt: true },
      }),
    ]);

    const items: ActivityItem[] = [
      ...stamps.map<ActivityItem>((e) => ({
        kind: "stamp",
        at: e.createdAt.toISOString(),
        customerPhoneSuffix: e.pass.customerPhone.slice(-4),
        meta: { stampsCount: e.pass.stampsCount },
      })),
      ...redemptions.map<ActivityItem>((r) => ({
        kind: "redemption",
        at: r.redeemedAt.toISOString(),
        customerPhoneSuffix: r.pass.customerPhone.slice(-4),
      })),
      ...enrollments.map<ActivityItem>((p) => ({
        kind: "enrollment",
        at: p.createdAt.toISOString(),
        customerPhoneSuffix: p.customerPhone.slice(-4),
      })),
      ...deletions.map<ActivityItem>((p) => ({
        kind: "pass_deleted",
        at: p.createdAt.toISOString(),
        customerPhoneSuffix: p.customerPhone.slice(-4),
      })),
    ];

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return items.slice(0, 20);
  }

  const PLAN_QUOTA: Record<string, number> = {
    STARTER: 300,
    GROWTH: 1500,
    PRO: 5000,
  };

  export interface PlanUsage {
    plan: string;
    used: number;
    quota: number;
    pct: number;
    band: "green" | "yellow" | "red";
  }

  export async function getPlanUsage(merchantId: string): Promise<PlanUsage> {
    const sub = await prisma.subscription.findUnique({ where: { merchantId } });
    const plan = sub?.plan ?? "STARTER";
    const quota = PLAN_QUOTA[plan] ?? 300;

    // Billing period ~ current month-to-date if no explicit start. Plan 6 stores
    // currentPeriodEnd; period start = end - 30d.
    const periodEnd = sub?.currentPeriodEnd ?? new Date();
    const periodStart = shiftDays(periodEnd, -30);

    const programIds = (
      await prisma.loyaltyProgram.findMany({
        where: { merchantId },
        select: { id: true },
      })
    ).map((x) => x.id);

    const used =
      programIds.length === 0
        ? 0
        : await prisma.pass.count({
            where: {
              programId: { in: programIds },
              createdAt: { gte: periodStart, lte: periodEnd },
            },
          });

    const pct = (used / quota) * 100;
    const band: PlanUsage["band"] = pct >= 100 ? "red" : pct >= 80 ? "yellow" : "green";

    return { plan, used, quota, pct, band };
  }
  ```
- [ ] Run tests — all green.
- [ ] Commit: `feat(analytics): aggregation queries with TDD`

---

## Task 5 — Cache layer (5-min TTL)

**Files:**
- `src/lib/analytics/cache.ts`
- `tests/lib/analytics/cache.test.ts`

**Steps:**

- [ ] Test first:
  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { cacheKey } from "@/lib/analytics/cache";

  describe("cacheKey", () => {
    it("scopes by merchantId and metric", () => {
      expect(cacheKey("kpis", "m_123")).toBe("dashboard:kpis:m_123");
      expect(cacheKey("trend", "m_abc")).toBe("dashboard:trend:m_abc");
    });
  });
  ```
- [ ] Implement:
  ```ts
  import "server-only";
  import { unstable_cache, revalidateTag } from "next/cache";
  import {
    getKpis,
    getStampsTrend,
    getFunnel,
    getRecentActivity,
    getPlanUsage,
  } from "./queries";

  export type CacheMetric = "kpis" | "trend" | "funnel" | "activity" | "plan";

  export function cacheKey(metric: CacheMetric, merchantId: string): string {
    return `dashboard:${metric}:${merchantId}`;
  }

  function tagsFor(merchantId: string): string[] {
    return [`merchant:${merchantId}`, "dashboard"];
  }

  const TTL_SECONDS = 60 * 5; // 5 min

  export function cachedKpis(merchantId: string) {
    return unstable_cache(
      () => getKpis(merchantId, { now: new Date(), periodDays: 7 }),
      [cacheKey("kpis", merchantId)],
      { revalidate: TTL_SECONDS, tags: tagsFor(merchantId) },
    )();
  }

  export function cachedTrend(merchantId: string) {
    return unstable_cache(
      () => getStampsTrend(merchantId, { now: new Date(), days: 30 }),
      [cacheKey("trend", merchantId)],
      { revalidate: TTL_SECONDS, tags: tagsFor(merchantId) },
    )();
  }

  export function cachedFunnel(merchantId: string) {
    return unstable_cache(
      () => getFunnel(merchantId),
      [cacheKey("funnel", merchantId)],
      { revalidate: TTL_SECONDS, tags: tagsFor(merchantId) },
    )();
  }

  export function cachedActivity(merchantId: string) {
    return unstable_cache(
      () => getRecentActivity(merchantId),
      [cacheKey("activity", merchantId)],
      { revalidate: 60, tags: tagsFor(merchantId) }, // tighter — feed should feel live
    )();
  }

  export function cachedPlanUsage(merchantId: string) {
    return unstable_cache(
      () => getPlanUsage(merchantId),
      [cacheKey("plan", merchantId)],
      { revalidate: TTL_SECONDS, tags: tagsFor(merchantId) },
    )();
  }

  /** Call from server actions that mutate dashboard data (stamp, enrollment...). */
  export function invalidateMerchant(merchantId: string): void {
    revalidateTag(`merchant:${merchantId}`);
  }
  ```
- [ ] Wire `invalidateMerchant(merchantId)` into the existing `addStamp`, `redeemReward`, `enroll`, `completeOnboarding` actions (right after the DB write, same place we added `track()`).
- [ ] Commit: `feat(analytics): unstable_cache wrappers + tag-based invalidation`

---

## Task 6 — Sentry release config

**Files:**
- `src/lib/sentry/config.ts`
- `sentry.client.config.ts` (modify — exists from Plan 1)
- `sentry.server.config.ts` (modify)
- `sentry.edge.config.ts` (modify)
- `tests/lib/sentry/config.test.ts`

**Steps:**

- [ ] Test first:
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { sentryRuntimeConfig } from "@/lib/sentry/config";

  describe("sentryRuntimeConfig", () => {
    beforeEach(() => {
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.VERCEL_ENV;
    });

    it("uses VERCEL_GIT_COMMIT_SHA as release tag in production", () => {
      process.env.VERCEL_GIT_COMMIT_SHA = "abc123def456";
      process.env.VERCEL_ENV = "production";
      const cfg = sentryRuntimeConfig();
      expect(cfg.release).toBe("stampme@abc123def456");
      expect(cfg.environment).toBe("production");
    });

    it("falls back to 'dev' when no Vercel env vars", () => {
      const cfg = sentryRuntimeConfig();
      expect(cfg.release).toBe("stampme@dev");
      expect(cfg.environment).toBe("development");
    });

    it("sets traces sample rate lower in production", () => {
      process.env.VERCEL_ENV = "production";
      expect(sentryRuntimeConfig().tracesSampleRate).toBe(0.1);
      process.env.VERCEL_ENV = "preview";
      expect(sentryRuntimeConfig().tracesSampleRate).toBe(1.0);
    });
  });
  ```
- [ ] Implement `src/lib/sentry/config.ts`:
  ```ts
  export interface SentryRuntimeConfig {
    dsn: string | undefined;
    release: string;
    environment: "production" | "preview" | "development";
    tracesSampleRate: number;
    profilesSampleRate: number;
  }

  export function sentryRuntimeConfig(): SentryRuntimeConfig {
    const sha = process.env.VERCEL_GIT_COMMIT_SHA;
    const release = sha ? `stampme@${sha}` : "stampme@dev";

    const vercelEnv = process.env.VERCEL_ENV;
    const environment: SentryRuntimeConfig["environment"] =
      vercelEnv === "production"
        ? "production"
        : vercelEnv === "preview"
          ? "preview"
          : "development";

    return {
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      release,
      environment,
      tracesSampleRate: environment === "production" ? 0.1 : 1.0,
      profilesSampleRate: environment === "production" ? 0.1 : 1.0,
    };
  }
  ```
- [ ] Refactor `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` to consume `sentryRuntimeConfig()`:
  ```ts
  import * as Sentry from "@sentry/nextjs";
  import { sentryRuntimeConfig } from "@/lib/sentry/config";

  const cfg = sentryRuntimeConfig();
  Sentry.init({
    dsn: cfg.dsn,
    release: cfg.release,
    environment: cfg.environment,
    tracesSampleRate: cfg.tracesSampleRate,
    profilesSampleRate: cfg.profilesSampleRate,
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND"],
  });
  ```
- [ ] **Configure Sentry alerts manually in dashboard** (document only — no code):
  - Alert 1: Error rate > 1% over 5 min → notify Abdullah (email + push)
  - Alert 2: Apdex < 0.85 over 15 min
  - Alert 3: Transaction `passkit.api.*` p95 > 3s
  - Alert 4: Failure rate of any `/api/passkit/*` > 5% over 10 min
  - Alert 5: Failure rate of `/api/webhooks/hyperpay` > 1% (we lose money silently otherwise)
- [ ] Commit: `feat(sentry): release tracking + env-aware sampling`

---

## Task 7 — Dashboard page (server component)

**Files:**
- `src/app/[locale]/(merchant)/dashboard/page.tsx`
- `src/app/[locale]/(merchant)/dashboard/loading.tsx`
- `src/messages/ar.json` (modify — add dashboard keys)
- `src/messages/en.json` (modify)

**Steps:**

- [ ] Add dashboard i18n keys to `ar.json`:
  ```json
  {
    "dashboard": {
      "title": "لوحة التحكم",
      "kpi": {
        "passesIssued": "كروت صادرة",
        "stampsToday": "أختام اليوم",
        "rewardsRedeemed": "جوائز مصروفة",
        "vsLastWeek": "مقارنة بالأسبوع الماضي",
        "dailyAvg": "المتوسّط اليومي",
        "redemptionRate": "نسبة الاسترداد"
      },
      "trend": { "title": "الأختام آخر ٣٠ يوم" },
      "funnel": {
        "title": "مسار العميل",
        "enrolled": "تسجيل",
        "firstStamp": "أوّل ختم",
        "rewardEarned": "استحقّ الجائزة",
        "redeemed": "صرف الجائزة"
      },
      "activity": {
        "title": "آخر النشاطات",
        "stamp": "ختم جديد للعميل ****{suffix}",
        "enrollment": "عميل جديد ****{suffix}",
        "redemption": "صُرفت جائزة العميل ****{suffix}",
        "passDeleted": "حذف العميل ****{suffix} الكرت"
      },
      "plan": {
        "title": "الباقة",
        "used": "{used} / {quota} كرت هذا الشهر",
        "upgrade": "ترقية الباقة"
      }
    }
  }
  ```
- [ ] Mirror in `en.json` (English equivalents).
- [ ] Create `src/app/[locale]/(merchant)/dashboard/page.tsx`:
  ```tsx
  import { getTranslations } from "next-intl/server";
  import { redirect } from "next/navigation";
  import { getCurrentMerchant } from "@/lib/auth/merchant"; // from Plan 1/2
  import {
    cachedKpis,
    cachedTrend,
    cachedFunnel,
    cachedActivity,
    cachedPlanUsage,
  } from "@/lib/analytics/cache";
  import { KpiCard } from "./_components/KpiCard";
  import { StampsTrendChart } from "./_components/StampsTrendChart";
  import { Funnel } from "./_components/Funnel";
  import { ActivityFeed } from "./_components/ActivityFeed";
  import { PlanUsage } from "./_components/PlanUsage";

  export const dynamic = "force-dynamic"; // we cache via unstable_cache, not RSC

  export default async function DashboardPage() {
    const t = await getTranslations("dashboard");
    const merchant = await getCurrentMerchant();
    if (!merchant) redirect("/sign-in");
    if (!merchant.onboardingCompletedAt) redirect("/onboarding");

    const [kpis, trend, funnel, activity, plan] = await Promise.all([
      cachedKpis(merchant.id),
      cachedTrend(merchant.id),
      cachedFunnel(merchant.id),
      cachedActivity(merchant.id),
      cachedPlanUsage(merchant.id),
    ]);

    return (
      <main className="container mx-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            label={t("kpi.passesIssued")}
            value={kpis.passesIssued.current}
            delta={{
              pct: kpis.passesIssued.deltaPct,
              label: t("kpi.vsLastWeek"),
            }}
          />
          <KpiCard
            label={t("kpi.stampsToday")}
            value={kpis.stampsToday.count}
            sub={`${t("kpi.dailyAvg")}: ${kpis.stampsToday.dailyAvg30d}`}
          />
          <KpiCard
            label={t("kpi.rewardsRedeemed")}
            value={kpis.rewardsRedeemed.count}
            sub={`${t("kpi.redemptionRate")}: ${kpis.rewardsRedeemed.redemptionRatePct.toFixed(1)}%`}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border p-4 bg-card">
            <h2 className="font-semibold mb-3">{t("trend.title")}</h2>
            <StampsTrendChart data={trend} />
          </div>
          <div className="rounded-2xl border p-4 bg-card">
            <h2 className="font-semibold mb-3">{t("funnel.title")}</h2>
            <Funnel data={funnel} />
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border p-4 bg-card">
            <h2 className="font-semibold mb-3">{t("activity.title")}</h2>
            <ActivityFeed items={activity} />
          </div>
          <div className="rounded-2xl border p-4 bg-card">
            <h2 className="font-semibold mb-3">{t("plan.title")}</h2>
            <PlanUsage usage={plan} />
          </div>
        </section>
      </main>
    );
  }
  ```
- [ ] Create `loading.tsx` with skeleton cards (Tailwind `animate-pulse`):
  ```tsx
  export default function Loading() {
    return (
      <main className="container mx-auto p-4 md:p-6 space-y-6">
        <div className="h-8 w-40 bg-muted rounded animate-pulse" />
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border p-4 h-32 bg-muted animate-pulse" />
          ))}
        </section>
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border p-4 h-72 bg-muted animate-pulse" />
          <div className="rounded-2xl border p-4 h-72 bg-muted animate-pulse" />
        </section>
      </main>
    );
  }
  ```
- [ ] Update Plan 1/2's post-sign-in redirect: `if (merchant.onboardingCompletedAt) → /{locale}/dashboard`.
- [ ] Commit: `feat(dashboard): server-rendered KPI page with cached aggregations`

---

## Task 8 — KpiCard component

**File:** `src/app/[locale]/(merchant)/dashboard/_components/KpiCard.tsx`

```tsx
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface Props {
  label: string;
  value: number | string;
  sub?: string;
  delta?: { pct: number; label: string };
}

export function KpiCard({ label, value, sub, delta }: Props) {
  const positive = delta && delta.pct >= 0;
  return (
    <div className="rounded-2xl border bg-card p-4 flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-3xl font-bold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      {delta ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium",
            positive ? "text-emerald-600" : "text-red-600",
          )}
        >
          {positive ? (
            <ArrowUpRight className="size-3.5" />
          ) : (
            <ArrowDownRight className="size-3.5" />
          )}
          {Math.abs(delta.pct).toFixed(1)}% {delta.label}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] Commit: `feat(dashboard): KpiCard`

---

## Task 9 — StampsTrendChart (recharts, client component)

**File:** `src/app/[locale]/(merchant)/dashboard/_components/StampsTrendChart.tsx`

```tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { TrendPoint } from "@/lib/analytics/queries";
import { useLocale } from "next-intl";

interface Props { data: TrendPoint[]; }

export function StampsTrendChart({ data }: Props) {
  const locale = useLocale();
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const formatted = data.map((d) => ({
    ...d,
    label: formatter.format(new Date(d.date)),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={formatted} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 12, fontSize: 12 }}
            labelClassName="font-medium"
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] Commit: `feat(dashboard): StampsTrendChart with recharts`

---

## Task 10 — Funnel component

**File:** `src/app/[locale]/(merchant)/dashboard/_components/Funnel.tsx`

```tsx
import { useTranslations } from "next-intl";
import type { Funnel as FunnelData } from "@/lib/analytics/queries";

function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

interface Props { data: FunnelData; }

export function Funnel({ data }: Props) {
  const t = useTranslations("dashboard.funnel");
  const stages: Array<{ key: string; value: number; prev: number }> = [
    { key: "enrolled", value: data.enrolled, prev: data.enrolled },
    { key: "firstStamp", value: data.firstStamp, prev: data.enrolled },
    { key: "rewardEarned", value: data.rewardEarned, prev: data.firstStamp },
    { key: "redeemed", value: data.redeemed, prev: data.rewardEarned },
  ];
  const max = Math.max(...stages.map((s) => s.value), 1);

  return (
    <ul className="space-y-2">
      {stages.map((s) => (
        <li key={s.key} className="space-y-1">
          <div className="flex items-baseline justify-between text-sm">
            <span>{t(s.key)}</span>
            <span className="tabular-nums">
              {s.value} <span className="text-muted-foreground">({rate(s.value, s.prev)})</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(s.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] Commit: `feat(dashboard): Funnel`

---

## Task 11 — ActivityFeed (client — needs relative time)

**File:** `src/app/[locale]/(merchant)/dashboard/_components/ActivityFeed.tsx`

```tsx
"use client";
import { useTranslations, useLocale } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { Stamp, UserPlus, Gift, Trash2 } from "lucide-react";
import type { ActivityItem } from "@/lib/analytics/queries";

const ICONS = {
  stamp: Stamp,
  enrollment: UserPlus,
  redemption: Gift,
  pass_deleted: Trash2,
} as const;

interface Props { items: ActivityItem[]; }

export function ActivityFeed({ items }: Props) {
  const t = useTranslations("dashboard.activity");
  const locale = useLocale();
  const dfLocale = locale === "ar" ? ar : enUS;

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">—</p>;
  }

  return (
    <ul className="space-y-3 max-h-96 overflow-auto pr-1">
      {items.map((item, idx) => {
        const Icon = ICONS[item.kind];
        const labelKey =
          item.kind === "pass_deleted" ? "passDeleted" : item.kind;
        return (
          <li key={`${item.kind}-${idx}-${item.at}`} className="flex items-start gap-3">
            <Icon className="size-4 mt-0.5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                {t(labelKey, { suffix: item.customerPhoneSuffix })}
              </p>
              <time className="text-xs text-muted-foreground" dateTime={item.at}>
                {formatDistanceToNow(new Date(item.at), { addSuffix: true, locale: dfLocale })}
              </time>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] Commit: `feat(dashboard): ActivityFeed with i18n relative timestamps`

---

## Task 12 — PlanUsage component

**File:** `src/app/[locale]/(merchant)/dashboard/_components/PlanUsage.tsx`

```tsx
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PlanUsage as PlanUsageData } from "@/lib/analytics/queries";

const BAND_COLOR: Record<PlanUsageData["band"], string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

interface Props { usage: PlanUsageData; }

export function PlanUsage({ usage }: Props) {
  const t = useTranslations("dashboard.plan");
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm">{usage.plan}</span>
        <span className="text-sm tabular-nums">
          {t("used", { used: usage.used, quota: usage.quota })}
        </span>
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full transition-all", BAND_COLOR[usage.band])}
          style={{ width: `${Math.min(100, usage.pct)}%` }}
        />
      </div>
      {usage.band !== "green" && (
        <Link
          href="/billing/plans"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("upgrade")} →
        </Link>
      )}
    </div>
  );
}
```

- [ ] Commit: `feat(dashboard): PlanUsage with color band`

---

## Task 13 — Bundle analyzer + Next config

**File:** `next.config.ts` (modify)

```ts
import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const config: NextConfig = {
  experimental: { optimizePackageImports: ["recharts", "lucide-react", "date-fns"] },
  // ...other Plan 1 settings preserved...
};

export default withAnalyzer(withNextIntl(config));
```

- [ ] Add npm script: `"analyze": "ANALYZE=true next build"`.
- [ ] Commit: `chore(build): wrap next.config with bundle analyzer`

---

## Task 14 — Husky + lint-staged

**Files:**
- `.husky/pre-commit`
- `.lintstagedrc.json`
- `package.json` (modify — add `prepare` script)

**Steps:**

- [ ] `package.json`:
  ```json
  { "scripts": { "prepare": "husky" } }
  ```
- [ ] `bun install` → `bunx husky init` → produces `.husky/pre-commit`. Replace contents:
  ```sh
  bunx lint-staged
  ```
- [ ] `.lintstagedrc.json`:
  ```json
  {
    "*.{ts,tsx}": ["eslint --fix --max-warnings=0", "bash -c 'tsc -p tsconfig.json --noEmit --pretty'"],
    "*.{js,jsx}": ["eslint --fix --max-warnings=0"],
    "*.{json,md,yml,yaml}": ["prettier --write"],
    "prisma/schema.prisma": ["prisma format"]
  }
  ```
  Note: `tsc --noEmit` runs over the whole project (it has to — TS is project-scoped). lint-staged just triggers it once when any TS file is staged, so the cost is amortized.
- [ ] Commit: `chore(dx): husky pre-commit + lint-staged`

---

## Task 15 — GitHub Actions: lint/typecheck/test/build/bundle/Lighthouse

**File:** `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  NODE_VERSION: "20"
  BUN_VERSION: "1.1.x"

jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ env.BUN_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
      - run: bun install --frozen-lockfile
      - run: bunx prisma generate
      - run: bun run lint
      - run: bun run typecheck

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: stampme_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/stampme_test
      POSTHOG_API_KEY: phc_test
      NEXT_PUBLIC_POSTHOG_KEY: phc_test
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "${{ env.BUN_VERSION }}" }
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}" }
      - run: bun install --frozen-lockfile
      - run: bunx prisma migrate deploy
      - run: bun run test --run

  build-and-bundle:
    runs-on: ubuntu-latest
    needs: [lint-typecheck]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "${{ env.BUN_VERSION }}" }
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}" }
      - run: bun install --frozen-lockfile
      - run: bunx prisma generate
      - run: bun run build
        env:
          NEXT_PUBLIC_POSTHOG_KEY: phc_dummy
          NEXT_PUBLIC_SENTRY_DSN: https://dummy@sentry.io/0
      - name: Assert First-Load JS budget
        run: |
          node scripts/assert-bundle-size.mjs

  lighthouse:
    runs-on: ubuntu-latest
    needs: [build-and-bundle]
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ env.NODE_VERSION }}" }
      - run: bun add -g @lhci/cli@0.13.x
      - name: Wait for Vercel preview
        id: vercel
        uses: patrickedqvist/wait-for-vercel-preview@v1.3.1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          max_timeout: 300
      - run: lhci autorun --collect.url=${{ steps.vercel.outputs.url }} --upload.target=temporary-public-storage
        env:
          LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```

- [ ] Add `scripts/assert-bundle-size.mjs`:
  ```js
  // Walks .next/build-manifest + .next/app-build-manifest and asserts
  // First-Load JS for /[locale] (landing) does not exceed 200KB gzipped.
  import { readFile, stat } from "node:fs/promises";
  import { gzipSync } from "node:zlib";
  import path from "node:path";

  const BUDGET_KB = 200;
  const manifest = JSON.parse(
    await readFile(".next/app-build-manifest.json", "utf8"),
  );

  // Pick first available locale landing route.
  const routeKey =
    Object.keys(manifest.pages).find((k) => k === "/[locale]/page") ??
    Object.keys(manifest.pages).find((k) => k.endsWith("/page"));

  if (!routeKey) {
    console.error("Could not find landing page in manifest");
    process.exit(1);
  }

  const files = manifest.pages[routeKey];
  let totalGz = 0;
  for (const f of files) {
    const buf = await readFile(path.join(".next", f));
    totalGz += gzipSync(buf).byteLength;
  }
  const kb = totalGz / 1024;
  console.log(`First-Load JS (gzipped): ${kb.toFixed(1)}KB / ${BUDGET_KB}KB`);
  if (kb > BUDGET_KB) {
    console.error("Bundle budget exceeded.");
    process.exit(1);
  }
  ```
- [ ] Add `lighthouserc.json`:
  ```json
  {
    "ci": {
      "collect": { "numberOfRuns": 3, "settings": { "preset": "desktop" } },
      "assert": {
        "preset": "lighthouse:recommended",
        "assertions": {
          "categories:performance": ["error", { "minScore": 0.85 }],
          "categories:accessibility": ["error", { "minScore": 0.9 }],
          "categories:seo": ["warn", { "minScore": 0.9 }],
          "first-contentful-paint": ["warn", { "maxNumericValue": 2000 }],
          "largest-contentful-paint": ["warn", { "maxNumericValue": 2500 }]
        }
      }
    }
  }
  ```
- [ ] Commit: `ci: add bundle budget + Lighthouse jobs`

---

## Task 16 — Pre-launch QA checklist

**File:** `docs/runbooks/pre-launch-qa.md`

```markdown
# stampme — Pre-Launch QA Checklist

Run end-to-end on the **production domain** (`stampme.com`) the day before
beta kickoff. Do NOT skip items — each one represents a known failure mode
from the design spec or industry experience.

## Build & Deploy
- [ ] Latest commit on `main` deployed to Vercel production
- [ ] Domain `stampme.com` + `scan.stampme.com` resolve, SSL valid (≥30 days to expiry)
- [ ] Custom 404 + 500 pages styled, Arabic copy reads naturally

## Performance
- [ ] Lighthouse mobile ≥ 85 on landing page (`/ar`)
- [ ] Lighthouse mobile ≥ 85 on landing page (`/en`)
- [ ] First-Load JS on landing ≤ 200 KB (CI gate already enforces)
- [ ] Dashboard initial paint ≤ 2s on simulated 4G (Chrome DevTools throttling)

## Auth & Onboarding (Arabic)
- [ ] Sign up via SMS OTP from a real KSA number (+9665…)
- [ ] Receives OTP within 10s
- [ ] Onboarding wizard 3 steps: logo upload, color pick, vertical select
- [ ] Wizard validates 2MB logo limit
- [ ] Card designer renders preview that matches final pass

## Auth & Onboarding (English)
- [ ] Sign up flow in English: language toggle persists, RTL flips correctly
- [ ] All form labels translated, no leaked `dashboard.kpi.*` keys

## Pass Issuance — iPhone Safari
- [ ] Open enrollment link → enter phone → tap "Add to Apple Wallet"
- [ ] `.pkpass` downloads, Wallet opens with merchant logo + brand color
- [ ] Front-of-card shows "0 / 10 stamps" (or merchant config)
- [ ] Lock screen shows pass when at merchant's geofence (skip if not configured)

## Pass Issuance — Android Chrome
- [ ] Same enrollment flow → "Save to Google Wallet" deep link works
- [ ] Pass appears in Google Wallet app

## Staff Scanner
- [ ] `scan.stampme.com` PWA installs on iPhone
- [ ] `scan.stampme.com` PWA installs on Android
- [ ] PIN gate: wrong PIN → error; correct PIN → home
- [ ] Scan a real customer pass → stamp count increments by 1
- [ ] Push notification arrives on customer device within 5s
- [ ] Reach `stampsRequired` → "Reward Ready" button appears
- [ ] Tap "Redeem" → pass resets to 0, redemption logged

## Billing (HyperPay)
- [ ] Test transaction with mada test card (4012 0010 3714 1112) succeeds
- [ ] HyperPay webhook hits `/api/webhooks/hyperpay`, signature verified
- [ ] `Charge` row + `Subscription.status = ACTIVE`
- [ ] Recurring billing cron runs locally with mocked time, renews subscription
- [ ] Failed payment test card → `payment_failed` event in PostHog

## Email (Resend)
- [ ] Welcome email arrives in Gmail inbox (not spam)
- [ ] Welcome email arrives in Outlook.com inbox
- [ ] Welcome email arrives in iCloud Mail inbox
- [ ] All emails are SPF + DKIM aligned (check headers)
- [ ] Arabic body renders RTL in all 3 clients

## SMS (Unifonic)
- [ ] OTP delivered to +9665 number within 10s
- [ ] Sender name = "stampme" (not generic)

## Observability
- [ ] Throw a deliberate error from `/api/_test/sentry` → appears in Sentry dashboard
- [ ] Sentry release tag matches `VERCEL_GIT_COMMIT_SHA`
- [ ] PostHog event `pass_issued` arrives within 30s of test enrollment
- [ ] PostHog funnel: signup → first pass → first stamp → reward populated
- [ ] All 5 Sentry alerts configured (error rate, p95, PassKit, HyperPay, webhook)

## Compliance
- [ ] Privacy policy at `/privacy` covers PDPL: phone retention, deletion request flow
- [ ] Footer links to privacy + terms on landing + dashboard
- [ ] VAT line item shows on invoice PDF (15% on subtotal)
- [ ] Invoice numbering sequential (no gaps)

## UX
- [ ] All dashboard widgets have skeleton loading states
- [ ] All forms have inline error states
- [ ] Empty states have illustrations + CTA copy (zero passes, zero stamps)
- [ ] Mobile dashboard usable on iPhone SE (375px width)
```

- [ ] Commit: `docs(runbook): pre-launch QA checklist`

---

## Task 17 — Beta onboarding runbook

**File:** `docs/runbooks/beta-onboarding.md`

```markdown
# stampme — Beta Onboarding Runbook

**Audience:** internal (Abdullah). 5 cafes, in-person setup, ~30 min each.

## Beta cohort

| # | Cafe | District | Contact | Setup date |
|---|------|----------|---------|------------|
| 1 | TBD | Riyadh — Olaya | TBD | Day 0 |
| 2 | TBD | Riyadh — Diriyah | TBD | Day 1 |
| 3 | TBD | Jeddah — Tahlia | TBD | Day 2 |
| 4 | TBD | Riyadh — Nakheel | TBD | Day 3 |
| 5 | TBD | Dammam — Corniche | TBD | Day 3 |

> Replace with confirmed contacts before Day -1. Identification of these 5 is
> a **gating criterion for launch** — see spec §١٢ row 4.

## Pre-visit (the night before)
- [ ] Confirm appointment via WhatsApp
- [ ] Prepare a printed QR poster (A4, laminated) with cafe brand colors
- [ ] Charge demo iPhone + Android device

## On-site script (30 min)

### 1. Signup (5 min)
- Owner opens `stampme.com` on their phone
- Sign up with phone + email, receives OTP
- We tell them: "افتح حسابك بنفسك علشان كلّ شي يكون بإسمك"

### 2. Onboarding wizard (5 min)
- Upload cafe logo (we have it on a USB or AirDrop ready)
- Pick brand color from existing menu/branding
- Vertical: CAFE

### 3. Card design (5 min)
- Default 10 stamps, reward = "قهوة مجّانيّة" (or whatever they prefer)
- Show live preview on Apple + Google Wallet
- Save → PassKit program created

### 4. Print QR + add to bar (5 min)
- Generate QR from dashboard → print on hand-press laminator we brought
- Place at register (preferably eye-level, near payment terminal)

### 5. Cashier training (10 min)
- Install scanner PWA on cafe's existing iPad/iPhone behind bar
- Set 4-digit PIN
- Live drill: barista scans Abdullah's test pass 3x
- Practice the redemption flow at 10/10
- Print 1-page cheat sheet (Arabic, with screenshots) — leave behind

## Beta agreement (one-pager, signed)

### الشروط
- ٣ شهور مجّاناً ابتداءً من تاريخ التفعيل
- بعد ٣ شهور: ٩٩ ريال/شهر (Starter)، أوّل شهرين فيها خصم ٥٠٪
- في المقابل:
  - مكالمة feedback أسبوعيّة (٢٠ دقيقة)
  - إذن استخدام شعار الكافيه + اسمه في صفحة "عملاؤنا"
  - شهادة (testimonial) مكتوبة بعد شهر من الاستخدام

### حقوق الكافيه
- تستطيع إلغاء الخدمة في أي وقت
- بياناتك تخصّك — تُحذف خلال ٣٠ يوم من طلب الإلغاء (PDPL compliant)
- لا نشارك بيانات عملائك مع طرف ثالث

## Post-visit
- [ ] Add cafe to internal monitoring spreadsheet (rows: passes/day, stamps/day)
- [ ] Create dedicated Slack channel `#beta-{cafe-name}`
- [ ] Add owner + 1 manager to WhatsApp group `stampme — Beta Q1`
- [ ] Schedule weekly feedback call recurring (Sundays 4 PM)

## Feedback collection

- **Weekly Google Form** sent every Saturday night:
  1. كم عميل سجّل هذا الأسبوع؟ (numerical)
  2. هل صادفت أي مشكلة؟ (open text)
  3. ما الميزة الناقصة الأهم لك؟ (open text)
  4. على مقياس ١-١٠، كم احتمال توصي صديق تاجر بـ stampme؟ (NPS)
- **Weekly 1:1 call** — 20 min, recorded with permission, transcribed.
- **In-app**: Intercom-style widget (Phase 2) — for Phase 1 use email `feedback@stampme.com` link in dashboard footer.
```

- [ ] Commit: `docs(runbook): beta onboarding script + agreement`

---

## Task 18 — Launch-day runbook

**File:** `docs/runbooks/launch.md`

```markdown
# stampme — Launch Runbook (Phase 1, Week 8)

## Day -1 (Saturday)
- [ ] Final deploy to production (`main` branch)
- [ ] Confirm Vercel cron schedules:
  - `0 2 * * *` — billing renewals (`/api/cron/billing`)
  - `*/15 * * * *` — PassKit sync sweep (`/api/cron/passkit-sync`)
- [ ] Run full pre-launch QA checklist (`docs/runbooks/pre-launch-qa.md`)
- [ ] Verify Sentry alerts firing (trigger one manually via `/api/_test/sentry`)
- [ ] Verify PostHog events landing (trigger one signup on staging)
- [ ] Top up Unifonic SMS balance (≥ 1000 SAR)
- [ ] Ensure HyperPay merchant ID is in production mode (not sandbox)
- [ ] Print 5 QR posters (one per cafe) + cheat sheets

## Day 0 — Cafe #1 (Riyadh — Olaya)
- 09:00 Final smoke test on production from a fresh device
- 10:00 Travel to cafe
- 10:30 In-person setup (follow `beta-onboarding.md`)
- 11:30 Live: first real customer enrollment of the day
- 14:00 Watch Sentry + PostHog for the next 4 hours from a laptop
- 18:00 EOD report: passes issued, stamps given, errors? (entry in `launch-log.md`)

**Rollback criteria for Day 0:**
- If `pass_issued` fails > 3 times in 1 hour → pause new merchant onboarding, escalate to Sentry
- If HyperPay webhook fails → keep going (idempotent), but tag for manual reconciliation

## Day 1 — Cafe #2 (Riyadh — Diriyah)
- 09:00 Review overnight Sentry digest
- 10:30 Cafe #2 setup
- 14:00 Cafe #1 first daily check-in (WhatsApp): "كيف الحال؟ في أي شي ما يضبط؟"

## Day 2 — Cafe #3 (Jeddah — Tahlia)
- Full-day flight + setup. Bring backup laptop.

## Day 3 — Cafes #4 + #5 (Riyadh + Dammam)
- Two setups in one day = 6 hours travel. Confirmed cafes only.

## Day 4 — Day 6: Watch & wait
- Daily WhatsApp check-in with each cafe
- Daily review: Sentry errors / 24h, PostHog DAU, dashboard 5xx rate
- Monitor PassKit cost: `passes_issued / day` × estimated price

## Day 7 — First weekly feedback calls
- 20 min × 5 cafes = 1.5 hour block (Sunday 4–6 PM)
- Compile feedback into `feedback-log.md`
- Top 3 painpoints → tickets in GitHub for Phase 1.5

## Day 14 — Beta Metrics Review

Compare against spec §١٠ Phase 1 targets:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Active beta cafes | 5 | ? | |
| Passes issued (cumulative) | 500+ | ? | |
| Activation rate (signup → first pass) | > 60% | ? | |
| Time-to-first-pass | < 15 min | ? | |
| Sentry error rate | < 1% | ? | |
| PassKit API p95 | < 1.5s | ? | |
| Customer NPS (in-product survey at stamp #5) | n/a | ? | |
| Merchant NPS (week 2 call) | > 30 | ? | |

If any RED:
- Activation < 60% → audit onboarding wizard analytics, find drop-off step
- Time-to-first-pass > 15 min → simplify card designer, prefill more
- Sentry > 1% → freeze new feature work, fix top 3 errors

## On-call

- **On-call rotation:** Abdullah only (solo founder).
- **Reach paths (in priority order):**
  1. Sentry mobile app push
  2. PagerDuty (deferred to Phase 2 — too expensive for solo dev)
  3. Email (`alerts@stampme.com` → forwards to personal inbox + phone)
  4. Slack `#alerts` channel (mobile push enabled)
- **Hours:** Best-effort 24/7 in beta. Sunday–Thursday 09:00–22:00 KSA hard guarantee.
- **MTTA target (Phase 1):** 30 min for SEV-1 (payments down, all passes failing).
- **MTTR target:** 4 hours for SEV-1.

## Post-launch (Week 9+)

- Compile beta findings into design doc for Phase 2 priorities
- Decide: keep cafes on free, convert at month 3, or extend?
- First paid merchant target: end of Week 12
```

- [ ] Commit: `docs(runbook): launch-day operations`

---

## Task 19 — Final integration tests + commit

**Files:**
- `tests/integration/dashboard.test.tsx`
- `tests/lib/sentry/release.test.ts`

**Steps:**

- [ ] Add an integration test that snapshots the dashboard with mocked queries:
  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { render, screen } from "@testing-library/react";
  import DashboardPage from "@/app/[locale]/(merchant)/dashboard/page";

  vi.mock("@/lib/auth/merchant", () => ({
    getCurrentMerchant: () =>
      Promise.resolve({
        id: "m1",
        onboardingCompletedAt: new Date(),
      }),
  }));

  vi.mock("@/lib/analytics/cache", () => ({
    cachedKpis: () =>
      Promise.resolve({
        passesIssued: { current: 42, previous: 21, deltaPct: 100 },
        stampsToday: { count: 7, dailyAvg30d: 5 },
        rewardsRedeemed: { count: 3, redemptionRatePct: 7.1 },
      }),
    cachedTrend: () => Promise.resolve([]),
    cachedFunnel: () =>
      Promise.resolve({ enrolled: 50, firstStamp: 35, rewardEarned: 18, redeemed: 9 }),
    cachedActivity: () => Promise.resolve([]),
    cachedPlanUsage: () =>
      Promise.resolve({ plan: "STARTER", used: 250, quota: 300, pct: 83.3, band: "yellow" }),
  }));

  describe("Dashboard SSR", () => {
    it("renders KPIs and plan usage", async () => {
      const ui = await DashboardPage();
      render(ui);
      expect(screen.getByText("42")).toBeDefined();
      expect(screen.getByText(/100\.0%/)).toBeDefined();
    });
  });
  ```
- [ ] Verify all CI gates green.
- [ ] Final commit: `chore: dashboard + beta launch ready`

---

## Done — handoff

After Plan 7 lands:

- [ ] Tag release `v0.1.0-beta` on `main`
- [ ] Vercel production build green
- [ ] All 19 tasks above ticked
- [ ] All 5 beta cafes confirmed by name (replace TBDs in `beta-onboarding.md`)
- [ ] Day -1 checklist complete

The product is now ready for the 5-cafe beta launch defined in spec §١٠ Phase 1.

---
