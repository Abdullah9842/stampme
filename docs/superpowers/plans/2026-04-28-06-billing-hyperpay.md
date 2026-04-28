# stampme — Plan 6: Billing (HyperPay)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monetize via HyperPay — Starter plan 99 SAR/mo with 14-day trial. mada + Visa support, recurring charges, dunning, VAT-inclusive invoices, plan limits enforced at pass issuance.

**Architecture:** HyperPay COPYandPAY hosted form for first payment + RT (registration token) for recurring. Daily Vercel cron processes due subscriptions. Webhook reconciles. Charges + PaymentMethods in Postgres.

**Tech Stack:** HyperPay REST API (no SDK), undici, decimal.js, Resend, @react-pdf/renderer, Vercel cron

**Depends on:** Plans 1-5

**Spec reference:** `docs/superpowers/specs/2026-04-28-stampme-design.md` §٩, §١٢, §١٣

---

## Pre-flight: Account Setup (do once before coding)

- [ ] Sign up at https://www.hyperpay.com/ (KSA business account; needs CR + VAT cert + IBAN). Sandbox is auto-provisioned.
- [ ] Read the Test Mode docs: https://wordpresshyperpay.docs.oppwa.com/tutorials/integration-guide/testing
- [ ] Capture sandbox credentials from dashboard:
  - `entityId` for **Visa/Mastercard** channel (e.g. `8a8294174b7ecb28014b9699220015ca`)
  - `entityId` for **mada** channel (HyperPay separates mada — usually a *second* entityId, e.g. `8a8294174d0...`). Document URL: https://wordpresshyperpay.docs.oppwa.com/integrations/widget/mada
  - Bearer access token (single token works for both entityIds)
  - Webhook decryption key + IV (configure under Administration → Webhooks; HyperPay encrypts payloads with AES-256-GCM, see https://wordpresshyperpay.docs.oppwa.com/tutorials/webhooks)
- [ ] Add to `.env.local` and Vercel:
  ```bash
  HYPERPAY_ENV=test                # test | live
  HYPERPAY_BASE_URL=https://eu-test.oppwa.com   # live: https://eu-prod.oppwa.com
  HYPERPAY_ACCESS_TOKEN=OGE4Mjk0MTc0YjdlY2IyODAxNGI5...
  HYPERPAY_ENTITY_ID_CARD=8a8294174b7ecb28014b9699220015ca
  HYPERPAY_ENTITY_ID_MADA=8a8294174d0...
  HYPERPAY_WEBHOOK_KEY_HEX=<32-byte hex>      # decryption key (IV is per-payload, sent in X-Initialization-Vector header)
  CRON_SECRET=<random 32-byte hex>            # protects /api/cron/billing
  ```
- [ ] Verify in Vercel project settings → Environment Variables that all are set in **Production**, **Preview**, **Development**.
- [ ] Test card (sandbox): `4200 0000 0000 0000` exp `05/30` CVV `123` (Visa) — see https://wordpresshyperpay.docs.oppwa.com/reference/parameters#test-mode
- [ ] mada test card (sandbox): `5360 2300 0000 0040` exp `12/30` CVV `850`

---

## Files Owned by This Plan

```
prisma/schema.prisma                                              [MODIFY]
prisma/migrations/<ts>_billing/migration.sql                      [NEW]
src/lib/hyperpay/client.ts                                        [NEW]
src/lib/hyperpay/checkouts.ts                                     [NEW]
src/lib/hyperpay/recurring.ts                                     [NEW]
src/lib/hyperpay/webhooks.ts                                      [NEW]
src/lib/hyperpay/__tests__/client.test.ts                         [NEW]
src/lib/hyperpay/__tests__/checkouts.test.ts                      [NEW]
src/lib/hyperpay/__tests__/recurring.test.ts                      [NEW]
src/lib/hyperpay/__tests__/webhooks.test.ts                       [NEW]
src/lib/billing/limits.ts                                         [NEW]
src/lib/billing/vat.ts                                            [NEW]
src/lib/billing/invoices.ts                                       [NEW]
src/lib/billing/dunning.ts                                        [NEW]
src/lib/billing/__tests__/limits.test.ts                          [NEW]
src/lib/billing/__tests__/vat.test.ts                             [NEW]
src/lib/billing/__tests__/dunning.test.ts                         [NEW]
src/lib/actions/billing.ts                                        [NEW]
src/app/[locale]/(merchant)/billing/page.tsx                      [NEW]
src/app/[locale]/(merchant)/billing/return/page.tsx               [NEW]
src/app/[locale]/(merchant)/billing/_components/CheckoutForm.tsx  [NEW]
src/app/[locale]/(merchant)/billing/_components/PlanStatus.tsx    [NEW]
src/app/[locale]/(merchant)/billing/_components/InvoiceList.tsx   [NEW]
src/app/api/webhooks/hyperpay/route.ts                            [NEW]
src/app/api/cron/billing/route.ts                                 [NEW]
src/lib/actions/enrollment.ts                                     [MODIFY — Plan 4]
src/app/api/webhooks/clerk/route.ts                               [MODIFY — Plan 1]
vercel.json                                                       [MODIFY — Plan 1]
package.json                                                      [MODIFY]
```

---

## Task 1 — Install deps + extend Prisma schema

- [ ] Install:
  ```bash
  bun add undici decimal.js
  bun add -d @types/node
  ```
  `undici` is bundled with Node 18+ but pinning a version stabilizes the surface area we use (`fetch`, `Headers`). `decimal.js` avoids float drift on SAR (15 % VAT on 99 produces 14.85 exactly only with arbitrary-precision math).

- [ ] Edit `prisma/schema.prisma` — append models after the existing `Subscription` model (Plan 1):

  ```prisma
  model PaymentMethod {
    id            String   @id @default(cuid())
    merchantId    String   @unique
    hyperpayRtId  String   @unique          // registration token from HyperPay
    last4         String
    brand         String                    // "MADA" | "VISA" | "MASTER"
    expMonth      Int
    expYear       Int
    holderName    String?
    createdAt     DateTime @default(now())
    updatedAt     DateTime @updatedAt
    merchant      Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)

    @@index([merchantId])
  }

  model Charge {
    id              String        @id @default(cuid())
    merchantId      String
    subscriptionId  String?
    amountSar       Decimal       @db.Decimal(10, 2)   // pre-VAT
    vatSar          Decimal       @db.Decimal(10, 2)
    totalSar        Decimal       @db.Decimal(10, 2)   // amount + vat
    currency        String        @default("SAR")
    hyperpayRefId   String        @unique              // ndc / id from HyperPay
    status          ChargeStatus
    failureReason   String?
    invoicePdfKey   String?                            // R2 key
    createdAt       DateTime      @default(now())
    merchant        Merchant      @relation(fields: [merchantId], references: [id], onDelete: Cascade)
    subscription    Subscription? @relation(fields: [subscriptionId], references: [id])

    @@index([merchantId, createdAt(sort: Desc)])
    @@index([status])
  }

  enum ChargeStatus {
    SUCCEEDED
    FAILED
    PENDING
    REFUNDED
  }
  ```

- [ ] Add reverse relations to existing models:

  ```prisma
  model Merchant {
    // ...existing fields
    paymentMethod PaymentMethod?
    charges       Charge[]
  }

  model Subscription {
    // ...existing fields
    charges       Charge[]
    // Make sure currentPeriodStart exists — Plan 1 has currentPeriodEnd only.
    currentPeriodStart DateTime @default(now())
    retryCount         Int      @default(0)
    canceledAt         DateTime?
    trialEndsAt        DateTime?
  }
  ```

- [ ] Generate migration:
  ```bash
  bunx prisma migrate dev --name billing
  bunx prisma generate
  ```

- [ ] **Commit:** `feat(billing): add PaymentMethod and Charge models with VAT-aware decimals`

---

## Task 2 — VAT helper (TDD)

- [ ] Write `src/lib/billing/__tests__/vat.test.ts` first:

  ```ts
  import { describe, it, expect } from "vitest";
  import { computeVat, formatSar, KSA_VAT_RATE } from "../vat";
  import Decimal from "decimal.js";

  describe("VAT (KSA 15 %)", () => {
    it("KSA_VAT_RATE is exactly 0.15", () => {
      expect(KSA_VAT_RATE.toString()).toBe("0.15");
    });

    it("computes 14.85 SAR VAT on 99 SAR Starter plan", () => {
      const r = computeVat(new Decimal("99"));
      expect(r.amount.toFixed(2)).toBe("99.00");
      expect(r.vat.toFixed(2)).toBe("14.85");
      expect(r.total.toFixed(2)).toBe("113.85");
    });

    it("handles fractional inputs without float drift", () => {
      const r = computeVat(new Decimal("33.33"));
      // 33.33 * 0.15 = 4.9995 → round HALF_UP to 5.00
      expect(r.vat.toFixed(2)).toBe("5.00");
      expect(r.total.toFixed(2)).toBe("38.33");
    });

    it("formatSar uses ar-SA locale by default", () => {
      expect(formatSar(new Decimal("113.85"))).toMatch(/113[.,]85/);
    });
  });
  ```

- [ ] Implement `src/lib/billing/vat.ts`:

  ```ts
  import Decimal from "decimal.js";

  // Configure half-up rounding once for this module (banking/invoicing standard in KSA).
  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

  export const KSA_VAT_RATE = new Decimal("0.15");

  export interface VatBreakdown {
    amount: Decimal; // pre-VAT
    vat: Decimal;
    total: Decimal;
  }

  export function computeVat(amount: Decimal | string | number): VatBreakdown {
    const a = new Decimal(amount).toDecimalPlaces(2);
    const v = a.times(KSA_VAT_RATE).toDecimalPlaces(2);
    return { amount: a, vat: v, total: a.plus(v).toDecimalPlaces(2) };
  }

  export function formatSar(value: Decimal, locale: "ar-SA" | "en-SA" = "ar-SA") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "SAR",
      minimumFractionDigits: 2,
    }).format(value.toNumber());
  }

  // Plan price catalog (MVP: Starter only — see spec §٩)
  export const PLAN_PRICES_SAR = {
    STARTER: new Decimal("99"),
    GROWTH: new Decimal("249"),
    PRO: new Decimal("499"),
  } as const;
  ```

- [ ] Run `bun run test src/lib/billing/__tests__/vat.test.ts` — all pass.
- [ ] **Commit:** `feat(billing): add KSA VAT helper with decimal.js precision`

---

## Task 3 — HyperPay REST client

- [ ] Write `src/lib/hyperpay/__tests__/client.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { hyperpay, HyperpayError } from "../client";

  const mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.HYPERPAY_BASE_URL = "https://eu-test.oppwa.com";
    process.env.HYPERPAY_ACCESS_TOKEN = "tok_test";
  });

  describe("hyperpay client", () => {
    it("POSTs form-urlencoded with bearer auth", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "chk_1", result: { code: "000.200.100" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const r = await hyperpay.post<{ id: string }>("/v1/checkouts", {
        entityId: "ent_1",
        amount: "113.85",
        currency: "SAR",
        paymentType: "DB",
      });

      expect(r.id).toBe("chk_1");
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://eu-test.oppwa.com/v1/checkouts");
      expect(init.method).toBe("POST");
      expect(init.headers["Authorization"]).toBe("Bearer tok_test");
      expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(init.body).toContain("entityId=ent_1");
      expect(init.body).toContain("amount=113.85");
    });

    it("throws HyperpayError on non-success result code", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { code: "800.100.100", description: "card declined" } }), {
          status: 200,
        }),
      );

      await expect(hyperpay.post("/v1/checkouts", {})).rejects.toThrow(HyperpayError);
    });

    it("throws on HTTP 5xx", async () => {
      mockFetch.mockResolvedValueOnce(new Response("oops", { status: 502 }));
      await expect(hyperpay.post("/v1/checkouts", {})).rejects.toThrow(/502/);
    });
  });
  ```

- [ ] Implement `src/lib/hyperpay/client.ts`:

  ```ts
  // HyperPay (oppwa.com) thin REST client.
  // Docs: https://wordpresshyperpay.docs.oppwa.com/
  // We avoid an SDK on purpose — the API surface we need is small (~6 endpoints).

  export class HyperpayError extends Error {
    constructor(
      public code: string,
      public description: string,
      public httpStatus: number,
      public raw: unknown,
    ) {
      super(`HyperPay ${code}: ${description}`);
      this.name = "HyperpayError";
    }
  }

  // Result codes that count as "success" per
  // https://wordpresshyperpay.docs.oppwa.com/reference/resultCodes
  // 000.000.* (Transaction succeeded)
  // 000.100.1* (Successfully processed in INTEGRATOR_TEST mode)
  // 000.200.* (Pending — checkout created, awaiting customer)
  // 000.400.0* / 000.400.100 (Successfully created / pending review)
  const SUCCESS_PATTERNS = [
    /^(000\.000\.|000\.100\.1|000\.[34]00\.[1-3]|000\.600\.)/,
    /^(000\.200)/, // pending — fine for /v1/checkouts creation
    /^(000\.400\.0[^3]|000\.400\.100)/,
  ];

  export function isSuccess(code: string | undefined): boolean {
    if (!code) return false;
    return SUCCESS_PATTERNS.some((re) => re.test(code));
  }

  type FormBody = Record<string, string | number | boolean | undefined>;

  function encodeForm(body: FormBody): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      params.append(k, String(v));
    }
    return params.toString();
  }

  function baseUrl(): string {
    const u = process.env.HYPERPAY_BASE_URL;
    if (!u) throw new Error("HYPERPAY_BASE_URL not set");
    return u.replace(/\/$/, "");
  }

  function authHeader(): string {
    const t = process.env.HYPERPAY_ACCESS_TOKEN;
    if (!t) throw new Error("HYPERPAY_ACCESS_TOKEN not set");
    return `Bearer ${t}`;
  }

  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: FormBody): Promise<T> {
    const url = `${baseUrl()}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body && method !== "GET" ? encodeForm(body) : undefined,
      // HyperPay can be slow under load — 30 s is their published P99.
      signal: AbortSignal.timeout(30_000),
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new HyperpayError("NETWORK", `Non-JSON response (${res.status})`, res.status, null);
    }

    const code = json?.result?.code;
    if (!res.ok || (code && !isSuccess(code))) {
      throw new HyperpayError(
        code ?? `HTTP_${res.status}`,
        json?.result?.description ?? "request failed",
        res.status,
        json,
      );
    }
    return json as T;
  }

  export const hyperpay = {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body: FormBody) => call<T>("POST", path, body),
    delete: <T>(path: string) => call<T>("DELETE", path),
  };
  ```

- [ ] Run tests, confirm green.
- [ ] **Commit:** `feat(hyperpay): add typed REST client with HyperpayError`

---

## Task 4 — Checkout creation (COPYandPAY)

- [ ] Write `src/lib/hyperpay/__tests__/checkouts.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { createCheckout, getCheckoutStatus } from "../checkouts";
  import { hyperpay } from "../client";

  vi.mock("../client", () => ({
    hyperpay: { post: vi.fn(), get: vi.fn() },
    isSuccess: (c: string) => c?.startsWith("000."),
  }));

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.HYPERPAY_ENTITY_ID_CARD = "ent_card";
    process.env.HYPERPAY_ENTITY_ID_MADA = "ent_mada";
  });

  describe("createCheckout", () => {
    it("uses card entityId by default and requests RT registration", async () => {
      vi.mocked(hyperpay.post).mockResolvedValue({ id: "chk_1", result: { code: "000.200.100" } } as any);

      const r = await createCheckout({
        merchantId: "m1",
        amountSar: "113.85",
        plan: "STARTER",
        channel: "card",
      });

      expect(r.checkoutId).toBe("chk_1");
      const [, body] = vi.mocked(hyperpay.post).mock.calls[0];
      expect(body).toMatchObject({
        entityId: "ent_card",
        amount: "113.85",
        currency: "SAR",
        paymentType: "DB",
        createRegistration: "true",
        "customParameters[merchantId]": "m1",
        "customParameters[plan]": "STARTER",
      });
    });

    it("uses mada entityId when channel=mada", async () => {
      vi.mocked(hyperpay.post).mockResolvedValue({ id: "chk_2", result: { code: "000.200.100" } } as any);
      await createCheckout({ merchantId: "m1", amountSar: "113.85", plan: "STARTER", channel: "mada" });
      expect(vi.mocked(hyperpay.post).mock.calls[0][1].entityId).toBe("ent_mada");
    });
  });

  describe("getCheckoutStatus", () => {
    it("queries /v1/checkouts/{id}/payment with entityId in querystring", async () => {
      vi.mocked(hyperpay.get).mockResolvedValue({
        id: "chk_1",
        registrationId: "rt_1",
        result: { code: "000.000.000" },
        card: { last4Digits: "0000", bin: "420000", expiryMonth: "05", expiryYear: "2030" },
        paymentBrand: "VISA",
      } as any);

      const r = await getCheckoutStatus("chk_1", "card");
      expect(r.success).toBe(true);
      expect(r.registrationId).toBe("rt_1");
      expect(r.last4).toBe("0000");
      expect(r.brand).toBe("VISA");
      expect(vi.mocked(hyperpay.get).mock.calls[0][0]).toBe(
        "/v1/checkouts/chk_1/payment?entityId=ent_card",
      );
    });
  });
  ```

- [ ] Implement `src/lib/hyperpay/checkouts.ts`:

  ```ts
  import { hyperpay, isSuccess } from "./client";

  export type Channel = "card" | "mada";
  export type PlanCode = "STARTER" | "GROWTH" | "PRO";

  export interface CreateCheckoutInput {
    merchantId: string;
    amountSar: string;     // pre-formatted "113.85"
    plan: PlanCode;
    channel: Channel;
    customerEmail?: string;
  }

  export interface CreateCheckoutResult {
    checkoutId: string;
  }

  function entityIdFor(channel: Channel): string {
    const id =
      channel === "mada"
        ? process.env.HYPERPAY_ENTITY_ID_MADA
        : process.env.HYPERPAY_ENTITY_ID_CARD;
    if (!id) throw new Error(`HYPERPAY_ENTITY_ID_${channel.toUpperCase()} not set`);
    return id;
  }

  /**
   * Create a COPYandPAY checkout session.
   * Docs: https://wordpresshyperpay.docs.oppwa.com/integrations/widget
   *
   * `createRegistration=true` returns an RT (registration token) on success which
   * we store and use for off-session recurring charges.
   */
  export async function createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const res = await hyperpay.post<{ id: string; result: { code: string } }>("/v1/checkouts", {
      entityId: entityIdFor(input.channel),
      amount: input.amountSar,
      currency: "SAR",
      paymentType: "DB",
      createRegistration: "true",
      "customParameters[merchantId]": input.merchantId,
      "customParameters[plan]": input.plan,
      "customer.email": input.customerEmail,
      // 3DS is mandatory for SAMA-regulated cards (mada). HyperPay enables it
      // automatically on the mada channel — no extra params required.
    });
    return { checkoutId: res.id };
  }

  export interface CheckoutStatus {
    success: boolean;
    code: string;
    description: string;
    registrationId?: string;     // RT for recurring
    last4?: string;
    brand?: string;
    expMonth?: number;
    expYear?: number;
    holderName?: string;
    hyperpayRefId: string;       // payment id (ndc)
    raw: unknown;
  }

  export async function getCheckoutStatus(checkoutId: string, channel: Channel): Promise<CheckoutStatus> {
    const res = await hyperpay.get<any>(
      `/v1/checkouts/${encodeURIComponent(checkoutId)}/payment?entityId=${entityIdFor(channel)}`,
    );

    return {
      success: isSuccess(res?.result?.code),
      code: res?.result?.code ?? "",
      description: res?.result?.description ?? "",
      registrationId: res?.registrationId,
      last4: res?.card?.last4Digits,
      brand: res?.paymentBrand,
      expMonth: res?.card?.expiryMonth ? Number(res.card.expiryMonth) : undefined,
      expYear: res?.card?.expiryYear ? Number(res.card.expiryYear) : undefined,
      holderName: res?.card?.holder,
      hyperpayRefId: res?.id ?? checkoutId,
      raw: res,
    };
  }
  ```

- [ ] Run tests, confirm green.
- [ ] **Commit:** `feat(hyperpay): COPYandPAY checkout creation + status query`

---

## Task 5 — Recurring charges via Registration Token

- [ ] Write `src/lib/hyperpay/__tests__/recurring.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { chargeRegistration } from "../recurring";
  import { hyperpay } from "../client";

  vi.mock("../client", () => ({
    hyperpay: { post: vi.fn() },
    isSuccess: (c: string) => c?.startsWith("000.000."),
  }));

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.HYPERPAY_ENTITY_ID_CARD = "ent_card";
    process.env.HYPERPAY_ENTITY_ID_MADA = "ent_mada";
  });

  describe("chargeRegistration", () => {
    it("POSTs to /v1/registrations/{rt}/payments with recurring flag", async () => {
      vi.mocked(hyperpay.post).mockResolvedValue({
        id: "pay_1",
        result: { code: "000.000.000", description: "ok" },
      } as any);

      const r = await chargeRegistration({
        rtId: "rt_xyz",
        amountSar: "113.85",
        channel: "mada",
        merchantId: "m1",
      });

      expect(r.success).toBe(true);
      expect(r.hyperpayRefId).toBe("pay_1");
      const [path, body] = vi.mocked(hyperpay.post).mock.calls[0];
      expect(path).toBe("/v1/registrations/rt_xyz/payments");
      expect(body).toMatchObject({
        entityId: "ent_mada",
        amount: "113.85",
        currency: "SAR",
        paymentType: "DB",
        recurringType: "REPEATED",
        standingInstruction: "RECURRING",
        "customParameters[merchantId]": "m1",
      });
    });

    it("returns failure flag on declined card", async () => {
      vi.mocked(hyperpay.post).mockRejectedValue(
        Object.assign(new Error("declined"), { code: "800.100.100", description: "card declined" }),
      );
      const r = await chargeRegistration({
        rtId: "rt_xyz",
        amountSar: "113.85",
        channel: "card",
        merchantId: "m1",
      });
      expect(r.success).toBe(false);
      expect(r.failureReason).toMatch(/card declined/);
    });
  });
  ```

- [ ] Implement `src/lib/hyperpay/recurring.ts`:

  ```ts
  import { hyperpay, isSuccess, HyperpayError } from "./client";
  import type { Channel } from "./checkouts";

  export interface ChargeRegistrationInput {
    rtId: string;
    amountSar: string;
    channel: Channel;
    merchantId: string;
  }

  export interface ChargeResult {
    success: boolean;
    hyperpayRefId?: string;
    code?: string;
    failureReason?: string;
  }

  /**
   * MIT (Merchant-Initiated Transaction) recurring charge.
   * Docs: https://wordpresshyperpay.docs.oppwa.com/tutorials/integration-guide/recurring
   *
   * `recurringType=REPEATED` + `standingInstruction=RECURRING` are required for
   * mada/Visa SAMA compliance — without them the issuer will block off-session.
   */
  export async function chargeRegistration(input: ChargeRegistrationInput): Promise<ChargeResult> {
    const entityId =
      input.channel === "mada"
        ? process.env.HYPERPAY_ENTITY_ID_MADA
        : process.env.HYPERPAY_ENTITY_ID_CARD;
    if (!entityId) throw new Error(`entityId for channel ${input.channel} missing`);

    try {
      const res = await hyperpay.post<{ id: string; result: { code: string; description: string } }>(
        `/v1/registrations/${encodeURIComponent(input.rtId)}/payments`,
        {
          entityId,
          amount: input.amountSar,
          currency: "SAR",
          paymentType: "DB",
          recurringType: "REPEATED",
          standingInstruction: "RECURRING",
          "customParameters[merchantId]": input.merchantId,
        },
      );

      return {
        success: isSuccess(res.result.code),
        hyperpayRefId: res.id,
        code: res.result.code,
      };
    } catch (e) {
      if (e instanceof HyperpayError) {
        return { success: false, code: e.code, failureReason: `${e.code}: ${e.description}` };
      }
      throw e;
    }
  }

  export async function deleteRegistration(rtId: string, channel: Channel): Promise<void> {
    const entityId =
      channel === "mada"
        ? process.env.HYPERPAY_ENTITY_ID_MADA
        : process.env.HYPERPAY_ENTITY_ID_CARD;
    await hyperpay.delete(`/v1/registrations/${encodeURIComponent(rtId)}?entityId=${entityId}`);
  }
  ```

- [ ] Run tests, confirm green.
- [ ] **Commit:** `feat(hyperpay): recurring MIT charges via registration tokens`

---

## Task 6 — Webhook signature verification + payload decryption

- [ ] HyperPay webhooks are AES-256-GCM encrypted (not HMAC — mistake to fix from spec wording).
  See https://wordpresshyperpay.docs.oppwa.com/tutorials/webhooks/integration. Header `X-Initialization-Vector` + body is hex-encoded ciphertext + auth tag (last 16 bytes).

- [ ] Write `src/lib/hyperpay/__tests__/webhooks.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { decryptWebhook } from "../webhooks";
  import { createCipheriv, randomBytes } from "node:crypto";

  function encrypt(plaintext: string, keyHex: string): { ciphertext: string; ivHex: string; authTagHex: string } {
    const key = Buffer.from(keyHex, "hex");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([enc, tag]).toString("hex"),
      ivHex: iv.toString("hex"),
      authTagHex: tag.toString("hex"),
    };
  }

  describe("decryptWebhook", () => {
    const keyHex = "0".repeat(64); // 32-byte hex
    process.env.HYPERPAY_WEBHOOK_KEY_HEX = keyHex;

    it("decrypts a valid payload", () => {
      const payload = JSON.stringify({ type: "PAYMENT", payload: { id: "pay_1" } });
      const { ciphertext, ivHex } = encrypt(payload, keyHex);
      const result = decryptWebhook(ciphertext, ivHex);
      expect(JSON.parse(result)).toMatchObject({ type: "PAYMENT" });
    });

    it("throws on tampered ciphertext", () => {
      const { ciphertext, ivHex } = encrypt("hello", keyHex);
      const tampered = ciphertext.slice(0, -2) + "00";
      expect(() => decryptWebhook(tampered, ivHex)).toThrow();
    });
  });
  ```

- [ ] Implement `src/lib/hyperpay/webhooks.ts`:

  ```ts
  import { createDecipheriv } from "node:crypto";

  /**
   * HyperPay sends webhooks AES-256-GCM encrypted.
   * Body = hex(ciphertext || authTag), header X-Initialization-Vector = hex(iv).
   * https://wordpresshyperpay.docs.oppwa.com/tutorials/webhooks/integration
   */
  export function decryptWebhook(bodyHex: string, ivHex: string): string {
    const keyHex = process.env.HYPERPAY_WEBHOOK_KEY_HEX;
    if (!keyHex) throw new Error("HYPERPAY_WEBHOOK_KEY_HEX not set");
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) throw new Error("HYPERPAY_WEBHOOK_KEY_HEX must be 32 bytes (64 hex chars)");

    const iv = Buffer.from(ivHex, "hex");
    const blob = Buffer.from(bodyHex, "hex");
    if (blob.length < 17) throw new Error("payload too short");

    const authTag = blob.subarray(blob.length - 16);
    const ciphertext = blob.subarray(0, blob.length - 16);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }

  export interface HyperpayWebhookEvent {
    type: "PAYMENT" | "REGISTRATION";
    action?: string;       // CREATED | UPDATED
    payload: {
      id: string;
      result: { code: string; description: string };
      amount?: string;
      currency?: string;
      paymentType?: string;
      registrationId?: string;
      customParameters?: Record<string, string>;
      [k: string]: unknown;
    };
  }

  export function parseWebhook(plaintext: string): HyperpayWebhookEvent {
    return JSON.parse(plaintext);
  }
  ```

- [ ] Run tests, confirm green.
- [ ] **Commit:** `feat(hyperpay): AES-256-GCM webhook decryption`

---

## Task 7 — Plan limits enforcement

- [ ] Write `src/lib/billing/__tests__/limits.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach, vi } from "vitest";
  import { canIssueNewPass, STARTER_PASS_LIMIT } from "../limits";

  // Mock prisma — see existing pattern in src/lib/db/__mocks__/
  vi.mock("@/lib/db", () => ({
    prisma: {
      subscription: { findUnique: vi.fn() },
      pass: { count: vi.fn() },
    },
  }));

  import { prisma } from "@/lib/db";

  beforeEach(() => vi.resetAllMocks());

  const baseSub = (overrides = {}) => ({
    status: "ACTIVE" as const,
    plan: "STARTER" as const,
    currentPeriodStart: new Date("2026-04-01"),
    currentPeriodEnd: new Date("2026-05-01"),
    trialEndsAt: null,
    ...overrides,
  });

  describe("canIssueNewPass", () => {
    it("allows ACTIVE Starter under limit", async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSub() as any);
      vi.mocked(prisma.pass.count).mockResolvedValue(50);

      const r = await canIssueNewPass("m1");
      expect(r.allowed).toBe(true);
    });

    it("allows TRIALING merchant", async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSub({ status: "TRIALING" }) as any);
      vi.mocked(prisma.pass.count).mockResolvedValue(10);

      const r = await canIssueNewPass("m1");
      expect(r.allowed).toBe(true);
    });

    it("rejects PAST_DUE", async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSub({ status: "PAST_DUE" }) as any);
      const r = await canIssueNewPass("m1");
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/inactive|past due/i);
    });

    it("rejects CANCELED", async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSub({ status: "CANCELED" }) as any);
      const r = await canIssueNewPass("m1");
      expect(r.allowed).toBe(false);
    });

    it("rejects when over Starter monthly limit (300)", async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSub() as any);
      vi.mocked(prisma.pass.count).mockResolvedValue(STARTER_PASS_LIMIT);

      const r = await canIssueNewPass("m1");
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/limit/i);
    });

    it("rejects when no subscription exists", async () => {
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
      const r = await canIssueNewPass("m1");
      expect(r.allowed).toBe(false);
    });
  });
  ```

- [ ] Implement `src/lib/billing/limits.ts`:

  ```ts
  import { prisma } from "@/lib/db";
  import type { Plan } from "@prisma/client";

  export const STARTER_PASS_LIMIT = 300;
  export const GROWTH_PASS_LIMIT = 1500;
  export const PRO_PASS_LIMIT = 5000;

  export function passLimitFor(plan: Plan): number {
    switch (plan) {
      case "STARTER": return STARTER_PASS_LIMIT;
      case "GROWTH":  return GROWTH_PASS_LIMIT;
      case "PRO":     return PRO_PASS_LIMIT;
    }
  }

  export interface CanIssueResult {
    allowed: boolean;
    reason?: "no_subscription" | "inactive" | "limit_exceeded";
    message?: string;
    used?: number;
    limit?: number;
  }

  export async function canIssueNewPass(merchantId: string): Promise<CanIssueResult> {
    const sub = await prisma.subscription.findUnique({ where: { merchantId } });
    if (!sub) {
      return { allowed: false, reason: "no_subscription", message: "No subscription found" };
    }

    if (sub.status === "PAST_DUE" || sub.status === "CANCELED") {
      return {
        allowed: false,
        reason: "inactive",
        message:
          sub.status === "PAST_DUE"
            ? "اشتراكك متأخّر — حدّث طريقة الدفع للمتابعة. / Your subscription is past due."
            : "اشتراكك ملغي. / Your subscription is canceled.",
      };
    }

    // TRIALING and ACTIVE both pass
    const limit = passLimitFor(sub.plan);
    const used = await prisma.pass.count({
      where: {
        program: { merchantId },
        createdAt: { gte: sub.currentPeriodStart },
      },
    });

    if (used >= limit) {
      return {
        allowed: false,
        reason: "limit_exceeded",
        message: `وصلت الحدّ الشهري (${limit} كرت). / Monthly limit (${limit}) reached.`,
        used,
        limit,
      };
    }

    return { allowed: true, used, limit };
  }
  ```

- [ ] Run tests, confirm green.
- [ ] **Commit:** `feat(billing): plan limits + canIssueNewPass guard`

---

## Task 8 — Hook limits into Plan 4's enrollment action

- [ ] Edit `src/lib/actions/enrollment.ts` — add at the top of `enrollCustomer`:

  ```ts
  // ... existing imports
  import { canIssueNewPass } from "@/lib/billing/limits";

  export async function enrollCustomer(input: EnrollInput) {
    // ── Plan 6 addition: gate on subscription state + monthly limit ──
    const merchantId = await resolveMerchantIdFromProgram(input.programId);
    const gate = await canIssueNewPass(merchantId);
    if (!gate.allowed) {
      throw new EnrollmentBlockedError(gate.reason ?? "inactive", gate.message ?? "blocked");
    }
    // ── end Plan 6 addition ──

    // ... existing enrollment logic from Plan 4
  }
  ```

  And export the error class (used by Plan 4 routes to map to HTTP 402/403):

  ```ts
  export class EnrollmentBlockedError extends Error {
    constructor(public reason: string, message: string) {
      super(message);
      this.name = "EnrollmentBlockedError";
    }
  }
  ```

- [ ] Add a unit test `src/lib/actions/__tests__/enrollment.billing.test.ts` that asserts an inactive subscription throws `EnrollmentBlockedError` before any PassKit call is made.
- [ ] **Commit:** `feat(enrollment): gate pass issuance on subscription status + plan limits`

---

## Task 9 — Trial creation in Clerk webhook

- [ ] Edit `src/app/api/webhooks/clerk/route.ts` (Plan 1) — when handling `user.created` after creating the `Merchant`, also create the trial subscription:

  ```ts
  // After: const merchant = await prisma.merchant.create({ ... });

  const TRIAL_DAYS = 14;
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.subscription.create({
    data: {
      merchantId: merchant.id,
      plan: "STARTER",
      status: "TRIALING",
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
      trialEndsAt,
    },
  });
  ```

- [ ] Add a webhook integration test asserting that after a `user.created` event the merchant has a `TRIALING` subscription with `trialEndsAt ≈ now + 14d`.
- [ ] **Commit:** `feat(billing): start 14-day TRIALING subscription on merchant signup`

---

## Task 10 — Dunning emails (Resend)

- [ ] Write `src/lib/billing/__tests__/dunning.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { sendDunning } from "../dunning";

  const sendMock = vi.fn().mockResolvedValue({ id: "email_1" });
  vi.mock("@/lib/email", () => ({ resend: { emails: { send: (...a: any[]) => sendMock(...a) } } }));

  beforeEach(() => sendMock.mockClear());

  describe("sendDunning", () => {
    it("renders trial_ending_soon in Arabic with English fallback", async () => {
      await sendDunning({
        type: "trial_ending_soon",
        to: "owner@cafe.sa",
        merchantName: "كافيه الورد",
        daysLeft: 3,
      });
      const arg = sendMock.mock.calls[0][0];
      expect(arg.to).toBe("owner@cafe.sa");
      expect(arg.subject).toMatch(/تجربة|trial/i);
      expect(arg.html).toContain("3");
    });

    it("trial_expired uses past tense", async () => {
      await sendDunning({ type: "trial_expired", to: "x@y.sa", merchantName: "X" });
      expect(sendMock.mock.calls[0][0].subject).toMatch(/انتهت|expired/i);
    });

    it("payment_failed includes retry day", async () => {
      await sendDunning({ type: "payment_failed", to: "x@y.sa", merchantName: "X", retry: 2, lastError: "card declined" });
      expect(sendMock.mock.calls[0][0].html).toContain("2");
    });
  });
  ```

- [ ] Implement `src/lib/billing/dunning.ts`:

  ```ts
  import { resend } from "@/lib/email";

  export type DunningType =
    | "trial_ending_soon"
    | "trial_expired"
    | "payment_failed"
    | "subscription_canceled"
    | "payment_succeeded";

  export interface DunningInput {
    type: DunningType;
    to: string;
    merchantName: string;
    daysLeft?: number;
    retry?: number;
    lastError?: string;
    invoiceUrl?: string;
  }

  const FROM = "stampme <billing@stampme.com>";
  const BILLING_URL = "https://stampme.com/ar/billing";

  function template(input: DunningInput): { subject: string; html: string; text: string } {
    const { merchantName } = input;
    switch (input.type) {
      case "trial_ending_soon": {
        const d = input.daysLeft ?? 3;
        return {
          subject: `تجربتك تنتهي خلال ${d} أيّام / Your stampme trial ends in ${d} days`,
          html: `
            <div dir="rtl" style="font-family:system-ui;max-width:560px;margin:auto">
              <h2>${merchantName}، تجربتك تنتهي خلال ${d} أيّام</h2>
              <p>أضف بطاقة الدفع الآن عشان ما يتعطّل إصدار كروتك للعملاء.</p>
              <p><a href="${BILLING_URL}" style="background:#000;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">إضافة بطاقة الدفع</a></p>
              <hr/>
              <div dir="ltr">
                <p>Hi ${merchantName}, your free trial ends in ${d} days. Add a payment method to keep issuing passes.</p>
                <p><a href="${BILLING_URL}">Add payment method</a></p>
              </div>
            </div>`,
          text: `${merchantName} — تجربتك تنتهي خلال ${d} أيّام. ${BILLING_URL}`,
        };
      }
      case "trial_expired":
        return {
          subject: `انتهت تجربتك — أضف بطاقة لإعادة التفعيل / Your trial expired`,
          html: `
            <div dir="rtl" style="font-family:system-ui;max-width:560px;margin:auto">
              <h2>${merchantName}، انتهت فترة التجربة المجّانيّة</h2>
              <p>كروت عملائك الحاليّة تشتغل عادي، لكن إصدار كروت جديدة متوقّف لحين تفعيل الاشتراك.</p>
              <p><a href="${BILLING_URL}">تفعيل الاشتراك (٩٩ ريال شهرياً + ١٥٪ ضريبة)</a></p>
            </div>`,
          text: `Trial expired. Activate at ${BILLING_URL}`,
        };
      case "payment_failed":
        return {
          subject: `فشل سحب الاشتراك — محاولة ${input.retry ?? 1}/3`,
          html: `<div dir="rtl"><p>${merchantName}، فشلت محاولة سحب الاشتراك (${input.lastError ?? "unknown"}). راح نعيد المحاولة بكرة.</p><p><a href="${BILLING_URL}">حدّث طريقة الدفع</a></p></div>`,
          text: `Payment failed (${input.lastError}). Update at ${BILLING_URL}`,
        };
      case "subscription_canceled":
        return {
          subject: `تمّ إلغاء اشتراكك / Subscription canceled`,
          html: `<div dir="rtl"><p>${merchantName}، تمّ إلغاء اشتراكك. تقدر تعود متى ما حبّيت.</p></div>`,
          text: `Subscription canceled.`,
        };
      case "payment_succeeded":
        return {
          subject: `تمّ الدفع — فاتورتك جاهزة / Payment received`,
          html: `<div dir="rtl"><p>شكراً ${merchantName}. <a href="${input.invoiceUrl}">تنزيل الفاتورة (PDF)</a></p></div>`,
          text: `Payment received. Invoice: ${input.invoiceUrl}`,
        };
    }
  }

  export async function sendDunning(input: DunningInput) {
    const t = template(input);
    return resend.emails.send({ from: FROM, to: input.to, subject: t.subject, html: t.html, text: t.text });
  }
  ```

- [ ] **Commit:** `feat(billing): bilingual dunning email templates via Resend`

---

## Task 11 — Invoice PDF generation

- [ ] Implement `src/lib/billing/invoices.ts`:

  ```ts
  import { Document, Page, Text, View, StyleSheet, pdf, Font } from "@react-pdf/renderer";
  import React from "react";
  import Decimal from "decimal.js";
  import { computeVat, formatSar } from "./vat";
  import { putR2Object } from "@/lib/storage/r2"; // from Plan 4

  // Register a font that supports Arabic (Plan 4 should already ship one for passes — reuse).
  // Fallback: use Helvetica + transliterate; spec says ar-first so we register Noto Naskh.
  Font.register({
    family: "NotoNaskh",
    src: "https://fonts.gstatic.com/s/notonaskharabic/v32/RrQ5bpV-9Dd1b1OAGA6M9PkyDuVBePeKNaxcsss0Y7bwvc5krK0z9_Mnuw.ttf",
  });

  const styles = StyleSheet.create({
    page: { padding: 40, fontSize: 11, fontFamily: "NotoNaskh", direction: "rtl" },
    header: { fontSize: 18, marginBottom: 8 },
    row: { flexDirection: "row", justifyContent: "space-between", marginVertical: 2 },
    table: { borderTop: "1pt solid #000", borderBottom: "1pt solid #000", marginTop: 16, paddingVertical: 8 },
    bold: { fontWeight: "bold" },
  });

  export interface InvoiceData {
    invoiceNumber: string;            // e.g. INV-2026-04-000123
    issuedAt: Date;
    merchantName: string;
    merchantVatNumber?: string;       // 15-digit ZATCA TRN if provided
    description: string;              // "Starter plan — April 2026"
    amountSar: Decimal;
    hyperpayRefId: string;
  }

  function InvoiceDoc({ data }: { data: InvoiceData }) {
    const { amount, vat, total } = computeVat(data.amountSar);
    return React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: styles.page },
        React.createElement(Text, { style: styles.header }, "فاتورة ضريبيّة مبسّطة / Simplified Tax Invoice"),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, null, `رقم الفاتورة: ${data.invoiceNumber}`),
          React.createElement(Text, null, `التاريخ: ${data.issuedAt.toISOString().slice(0, 10)}`),
        ),
        React.createElement(View, { style: { marginTop: 8 } },
          React.createElement(Text, null, `العميل: ${data.merchantName}`),
          data.merchantVatNumber
            ? React.createElement(Text, null, `الرقم الضريبي: ${data.merchantVatNumber}`)
            : null,
        ),
        React.createElement(View, { style: styles.table },
          React.createElement(View, { style: styles.row },
            React.createElement(Text, null, data.description),
            React.createElement(Text, null, formatSar(amount)),
          ),
          React.createElement(View, { style: styles.row },
            React.createElement(Text, null, "ضريبة القيمة المضافة (١٥٪)"),
            React.createElement(Text, null, formatSar(vat)),
          ),
          React.createElement(View, { style: [styles.row, styles.bold] },
            React.createElement(Text, null, "الإجمالي شامل الضريبة"),
            React.createElement(Text, null, formatSar(total)),
          ),
        ),
        React.createElement(View, { style: { marginTop: 24, fontSize: 9 } },
          React.createElement(Text, null, `Payment Ref: ${data.hyperpayRefId}`),
          React.createElement(Text, null, "stampme — KSA — VAT 15%"),
          React.createElement(Text, null, "ZATCA e-invoicing integration: Phase 2"),
        ),
      ),
    );
  }

  /** Render invoice → upload to R2 → return public URL key */
  export async function generateInvoicePdf(data: InvoiceData): Promise<{ key: string; url: string }> {
    const buffer = await pdf(InvoiceDoc({ data }) as any).toBuffer();
    const key = `invoices/${data.invoiceNumber}.pdf`;
    const url = await putR2Object(key, buffer, "application/pdf");
    return { key, url };
  }

  export function nextInvoiceNumber(seq: number, date = new Date()): string {
    const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return `INV-${ym}-${String(seq).padStart(6, "0")}`;
  }
  ```

- [ ] Snapshot test ensures the rendered PDF buffer is non-empty + > 1 KB. Skip pixel-diff (overkill for MVP).
- [ ] **Commit:** `feat(billing): VAT-inclusive invoice PDFs via @react-pdf/renderer`

---

## Task 12 — Server actions for billing

- [ ] Implement `src/lib/actions/billing.ts`:

  ```ts
  "use server";

  import { auth } from "@clerk/nextjs/server";
  import { z } from "zod";
  import { prisma } from "@/lib/db";
  import { computeVat, PLAN_PRICES_SAR } from "@/lib/billing/vat";
  import { createCheckout, getCheckoutStatus, type Channel } from "@/lib/hyperpay/checkouts";
  import { deleteRegistration } from "@/lib/hyperpay/recurring";
  import { sendDunning } from "@/lib/billing/dunning";
  import { revalidatePath } from "next/cache";
  import * as Sentry from "@sentry/nextjs";

  const StartCheckoutSchema = z.object({
    channel: z.enum(["card", "mada"]),
    plan: z.literal("STARTER"), // MVP: only Starter (spec §٩)
  });

  async function requireMerchant() {
    const { userId } = await auth();
    if (!userId) throw new Error("unauthenticated");
    const m = await prisma.merchant.findUnique({ where: { clerkUserId: userId } });
    if (!m) throw new Error("merchant not found");
    return m;
  }

  export async function startCheckoutAction(input: z.infer<typeof StartCheckoutSchema>) {
    const data = StartCheckoutSchema.parse(input);
    const merchant = await requireMerchant();
    const { total } = computeVat(PLAN_PRICES_SAR[data.plan]);

    const r = await createCheckout({
      merchantId: merchant.id,
      amountSar: total.toFixed(2),
      plan: data.plan,
      channel: data.channel as Channel,
      customerEmail: merchant.ownerEmail,
    });
    return { checkoutId: r.checkoutId, channel: data.channel, total: total.toFixed(2) };
  }

  /**
   * Called by /billing/return?id=...&resourcePath=... after HyperPay redirects back.
   * Server-side verifies the status (never trust the client).
   */
  export async function finalizeCheckoutAction(checkoutId: string, channel: Channel) {
    const merchant = await requireMerchant();
    const status = await getCheckoutStatus(checkoutId, channel);

    if (!status.success || !status.registrationId) {
      Sentry.captureMessage("checkout_failed", { extra: { checkoutId, code: status.code } });
      return { ok: false, reason: status.description || "Payment failed" };
    }

    // Persist payment method (idempotent on hyperpayRtId)
    await prisma.paymentMethod.upsert({
      where: { merchantId: merchant.id },
      update: {
        hyperpayRtId: status.registrationId,
        last4: status.last4 ?? "----",
        brand: (status.brand ?? "VISA").toUpperCase(),
        expMonth: status.expMonth ?? 1,
        expYear: status.expYear ?? 2099,
        holderName: status.holderName,
      },
      create: {
        merchantId: merchant.id,
        hyperpayRtId: status.registrationId,
        last4: status.last4 ?? "----",
        brand: (status.brand ?? "VISA").toUpperCase(),
        expMonth: status.expMonth ?? 1,
        expYear: status.expYear ?? 2099,
        holderName: status.holderName,
      },
    });

    // Move sub from TRIALING/PAST_DUE → ACTIVE; advance period 30 days
    const now = new Date();
    const next = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { merchantId: merchant.id },
      data: {
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: next,
        retryCount: 0,
        canceledAt: null,
      },
    });

    // Webhook will create the Charge record (single source of truth) — but if the
    // webhook arrives late, also write here idempotently keyed by hyperpayRefId.
    await recordChargeIfNew({
      merchantId: merchant.id,
      hyperpayRefId: status.hyperpayRefId,
      amountSarStr: (await getActivePriceTotal()).toFixed(2),
    });

    revalidatePath("/billing");
    return { ok: true };
  }

  export async function cancelSubscriptionAction() {
    const merchant = await requireMerchant();
    const sub = await prisma.subscription.findUnique({ where: { merchantId: merchant.id } });
    if (!sub) throw new Error("no subscription");

    await prisma.subscription.update({
      where: { merchantId: merchant.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    const pm = await prisma.paymentMethod.findUnique({ where: { merchantId: merchant.id } });
    if (pm) {
      try {
        await deleteRegistration(pm.hyperpayRtId, pm.brand === "MADA" ? "mada" : "card");
      } catch (e) {
        Sentry.captureException(e);
      }
      await prisma.paymentMethod.delete({ where: { merchantId: merchant.id } });
    }

    await sendDunning({
      type: "subscription_canceled",
      to: merchant.ownerEmail,
      merchantName: merchant.name,
    });
    revalidatePath("/billing");
    return { ok: true };
  }

  // Helpers
  async function getActivePriceTotal() {
    const { total } = computeVat(PLAN_PRICES_SAR.STARTER);
    return total;
  }

  async function recordChargeIfNew(args: {
    merchantId: string;
    hyperpayRefId: string;
    amountSarStr: string;
  }) {
    const exists = await prisma.charge.findUnique({ where: { hyperpayRefId: args.hyperpayRefId } });
    if (exists) return exists;
    const { amount, vat, total } = computeVat(args.amountSarStr);
    return prisma.charge.create({
      data: {
        merchantId: args.merchantId,
        hyperpayRefId: args.hyperpayRefId,
        amountSar: amount.toString(),
        vatSar: vat.toString(),
        totalSar: total.toString(),
        status: "SUCCEEDED",
      },
    });
  }

  export { recordChargeIfNew };
  ```

- [ ] **Commit:** `feat(billing): server actions for checkout, finalize, cancel`

---

## Task 13 — Billing UI page

- [ ] Implement `src/app/[locale]/(merchant)/billing/page.tsx`:

  ```tsx
  import { auth } from "@clerk/nextjs/server";
  import { redirect } from "next/navigation";
  import { prisma } from "@/lib/db";
  import { PlanStatus } from "./_components/PlanStatus";
  import { CheckoutForm } from "./_components/CheckoutForm";
  import { InvoiceList } from "./_components/InvoiceList";
  import { cancelSubscriptionAction } from "@/lib/actions/billing";

  export const metadata = { title: "الفوترة / Billing" };

  export default async function BillingPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const { userId } = await auth();
    if (!userId) redirect(`/${locale}/sign-in`);

    const merchant = await prisma.merchant.findUnique({
      where: { clerkUserId: userId },
      include: {
        subscription: true,
        paymentMethod: true,
        charges: { orderBy: { createdAt: "desc" }, take: 24 },
      },
    });
    if (!merchant?.subscription) redirect(`/${locale}/onboarding`);

    return (
      <main className="mx-auto max-w-3xl space-y-8 p-6" dir={locale === "ar" ? "rtl" : "ltr"}>
        <h1 className="text-2xl font-bold">{locale === "ar" ? "الفوترة" : "Billing"}</h1>

        <PlanStatus subscription={merchant.subscription} paymentMethod={merchant.paymentMethod} locale={locale} />

        {!merchant.paymentMethod || merchant.subscription.status === "PAST_DUE" ? (
          <CheckoutForm locale={locale} />
        ) : (
          <form action={cancelSubscriptionAction}>
            <button className="rounded border border-red-500 px-4 py-2 text-red-600 hover:bg-red-50">
              {locale === "ar" ? "إلغاء الاشتراك" : "Cancel subscription"}
            </button>
          </form>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold">
            {locale === "ar" ? "الفواتير" : "Invoices"}
          </h2>
          <InvoiceList charges={merchant.charges} locale={locale} />
        </section>

        <section className="rounded border bg-gray-50 p-4 text-sm text-gray-600">
          <p>{locale === "ar"
            ? "خطّتنا حالياً: Starter فقط. خطط Growth / Pro قريباً."
            : "Currently available: Starter only. Growth / Pro coming soon."}</p>
        </section>
      </main>
    );
  }
  ```

- [ ] Implement `_components/PlanStatus.tsx`:

  ```tsx
  import { Subscription, PaymentMethod } from "@prisma/client";

  export function PlanStatus({
    subscription,
    paymentMethod,
    locale,
  }: {
    subscription: Subscription;
    paymentMethod: PaymentMethod | null;
    locale: string;
  }) {
    const status = subscription.status;
    const badge = {
      TRIALING: { ar: "تجربة مجّانيّة", en: "Free trial", color: "bg-blue-100 text-blue-800" },
      ACTIVE:   { ar: "نشط", en: "Active", color: "bg-green-100 text-green-800" },
      PAST_DUE: { ar: "متأخّر", en: "Past due", color: "bg-amber-100 text-amber-800" },
      CANCELED: { ar: "ملغي", en: "Canceled", color: "bg-gray-200 text-gray-700" },
    }[status];

    return (
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{subscription.plan} · 99 SAR/mo + 15% VAT</div>
            <div className="text-sm text-gray-500">
              {locale === "ar" ? "تاريخ التجديد:" : "Renews on:"}{" "}
              {subscription.currentPeriodEnd.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-SA")}
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm ${badge.color}`}>
            {locale === "ar" ? badge.ar : badge.en}
          </span>
        </div>
        {paymentMethod && (
          <div className="mt-3 text-sm text-gray-600">
            {paymentMethod.brand} •••• {paymentMethod.last4} · {paymentMethod.expMonth}/{paymentMethod.expYear}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] Implement `_components/InvoiceList.tsx` — render `Charge[]` rows: date, total (formatSar), status pill, link to invoicePdfKey via signed URL helper.

- [ ] Implement `_components/CheckoutForm.tsx`:

  ```tsx
  "use client";

  import { useState, useTransition } from "react";
  import Script from "next/script";
  import { startCheckoutAction } from "@/lib/actions/billing";

  export function CheckoutForm({ locale }: { locale: string }) {
    const [pending, startTransition] = useTransition();
    const [checkoutId, setCheckoutId] = useState<string | null>(null);
    const [channel, setChannel] = useState<"card" | "mada">("mada");
    const [error, setError] = useState<string | null>(null);

    function start() {
      setError(null);
      startTransition(async () => {
        try {
          const r = await startCheckoutAction({ channel, plan: "STARTER" });
          setCheckoutId(r.checkoutId);
        } catch (e: any) {
          setError(e.message ?? "failed");
        }
      });
    }

    if (checkoutId) {
      const widgetSrc = `${process.env.NEXT_PUBLIC_HYPERPAY_BASE_URL ?? "https://eu-test.oppwa.com"}/v1/paymentWidgets.js?checkoutId=${checkoutId}`;
      const returnUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/${locale}/billing/return?channel=${channel}`;
      const brands = channel === "mada" ? "MADA" : "VISA MASTER";
      return (
        <div className="rounded-lg border p-4">
          <Script src={widgetSrc} strategy="afterInteractive" />
          {/* HyperPay COPYandPAY hosted form. Docs: https://wordpresshyperpay.docs.oppwa.com/integrations/widget/customization */}
          <form action={returnUrl} className="paymentWidgets" data-brands={brands} />
        </div>
      );
    }

    return (
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">
          {locale === "ar" ? "اختر طريقة الدفع" : "Choose a payment method"}
        </h3>
        <div className="flex gap-2">
          {(["mada", "card"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`rounded border px-4 py-2 ${channel === c ? "border-black bg-black text-white" : ""}`}
            >
              {c === "mada" ? "مدى" : locale === "ar" ? "بطاقة Visa/Master" : "Visa / Mastercard"}
            </button>
          ))}
        </div>
        <button
          onClick={start}
          disabled={pending}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {pending ? "..." : locale === "ar" ? "متابعة" : "Continue"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }
  ```

- [ ] Implement return page `src/app/[locale]/(merchant)/billing/return/page.tsx`:

  ```tsx
  import { redirect } from "next/navigation";
  import { finalizeCheckoutAction } from "@/lib/actions/billing";

  export default async function BillingReturnPage({
    searchParams,
    params,
  }: {
    searchParams: Promise<{ id?: string; resourcePath?: string; channel?: "card" | "mada" }>;
    params: Promise<{ locale: string }>;
  }) {
    const sp = await searchParams;
    const { locale } = await params;
    if (!sp.id) redirect(`/${locale}/billing`);

    const r = await finalizeCheckoutAction(sp.id, sp.channel ?? "card");
    if (r.ok) redirect(`/${locale}/billing?success=1`);
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold text-red-600">
          {locale === "ar" ? "فشلت العمليّة" : "Payment failed"}
        </h1>
        <p className="mt-2 text-gray-600">{r.reason}</p>
        <a href={`/${locale}/billing`} className="mt-4 inline-block underline">
          {locale === "ar" ? "حاول مجدّداً" : "Try again"}
        </a>
      </main>
    );
  }
  ```

- [ ] **Commit:** `feat(billing): merchant billing UI with COPYandPAY hosted form`

---

## Task 14 — Webhook route handler

- [ ] Implement `src/app/api/webhooks/hyperpay/route.ts`:

  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import * as Sentry from "@sentry/nextjs";
  import { decryptWebhook, parseWebhook } from "@/lib/hyperpay/webhooks";
  import { prisma } from "@/lib/db";
  import { computeVat } from "@/lib/billing/vat";
  import { sendDunning } from "@/lib/billing/dunning";

  // HyperPay calls webhooks server-to-server. We accept text/plain (encrypted hex).
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  export async function POST(req: NextRequest) {
    const ivHex = req.headers.get("x-initialization-vector");
    const authTag = req.headers.get("x-authentication-tag"); // some HyperPay regions send tag separately
    if (!ivHex) return new NextResponse("missing IV", { status: 400 });

    const bodyHex = (await req.text()).trim();

    let plaintext: string;
    try {
      plaintext = decryptWebhook(bodyHex, ivHex);
    } catch (e) {
      Sentry.captureException(e, { tags: { area: "hyperpay_webhook_decrypt" } });
      return new NextResponse("bad payload", { status: 400 });
    }

    let event;
    try {
      event = parseWebhook(plaintext);
    } catch {
      return new NextResponse("bad json", { status: 400 });
    }

    // Idempotency: dedupe on payload.id
    const refId = event.payload.id;
    if (!refId) return new NextResponse("no id", { status: 400 });

    if (event.type !== "PAYMENT") {
      // We don't act on REGISTRATION events for now (handled inline in finalizeCheckoutAction)
      return NextResponse.json({ ok: true, ignored: true });
    }

    const merchantId = event.payload.customParameters?.merchantId;
    if (!merchantId) {
      Sentry.captureMessage("hyperpay_webhook_missing_merchantId", { extra: { refId } });
      return new NextResponse("missing merchantId", { status: 400 });
    }

    const code = event.payload.result.code;
    const success = /^(000\.000\.|000\.100\.1|000\.[34]00\.[1-3]|000\.600\.)/.test(code);

    const existing = await prisma.charge.findUnique({ where: { hyperpayRefId: refId } });
    if (existing) {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    if (success) {
      const amountStr = event.payload.amount ?? "113.85";
      const { amount, vat, total } = computeVat(amountStr);
      // Note: HyperPay returns the gross "amount" we sent (already VAT-inclusive).
      // We re-derive the breakdown for invoice purposes (total minus 15/115 of total).
      const grossTotal = total; // == amount we sent
      const preVat = grossTotal.div(1.15).toDecimalPlaces(2);
      const vatPart = grossTotal.minus(preVat).toDecimalPlaces(2);

      await prisma.charge.create({
        data: {
          merchantId,
          hyperpayRefId: refId,
          amountSar: preVat.toString(),
          vatSar: vatPart.toString(),
          totalSar: grossTotal.toString(),
          status: "SUCCEEDED",
        },
      });

      // Extend subscription
      const sub = await prisma.subscription.findUnique({ where: { merchantId } });
      if (sub) {
        const next = new Date(Math.max(Date.now(), sub.currentPeriodEnd.getTime()) + 30 * 86400_000);
        await prisma.subscription.update({
          where: { merchantId },
          data: { status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: next, retryCount: 0 },
        });
      }
    } else {
      await prisma.charge.create({
        data: {
          merchantId,
          hyperpayRefId: refId,
          amountSar: "0",
          vatSar: "0",
          totalSar: "0",
          status: "FAILED",
          failureReason: `${code}: ${event.payload.result.description}`,
        },
      });

      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
      if (merchant) {
        const sub = await prisma.subscription.findUnique({ where: { merchantId } });
        const retry = (sub?.retryCount ?? 0) + 1;
        await prisma.subscription.update({
          where: { merchantId },
          data: { status: "PAST_DUE", retryCount: retry },
        });
        await sendDunning({
          type: "payment_failed",
          to: merchant.ownerEmail,
          merchantName: merchant.name,
          retry,
          lastError: event.payload.result.description,
        });
      }
    }

    return NextResponse.json({ ok: true });
  }
  ```

- [ ] Add an integration test that sends an encrypted body twice and asserts only one `Charge` row is created (idempotency).
- [ ] **Commit:** `feat(billing): HyperPay webhook with idempotent charge reconciliation`

---

## Task 15 — Daily cron: trial expiry, recurring charges, retries

- [ ] Implement `src/app/api/cron/billing/route.ts`:

  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { prisma } from "@/lib/db";
  import { chargeRegistration } from "@/lib/hyperpay/recurring";
  import { computeVat, PLAN_PRICES_SAR } from "@/lib/billing/vat";
  import { sendDunning } from "@/lib/billing/dunning";
  import * as Sentry from "@sentry/nextjs";

  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  const MAX_RETRIES = 3;

  export async function GET(req: NextRequest) {
    // Vercel cron sends Authorization: Bearer <CRON_SECRET>
    if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("unauthorized", { status: 401 });
    }

    const now = new Date();
    const summary = { trialReminders: 0, trialExpired: 0, charged: 0, failed: 0, canceled: 0 };

    // 1. Trial ending soon (3 days out)
    const reminderCutoff = new Date(now.getTime() + 3 * 86400_000);
    const reminderWindowStart = new Date(now.getTime() + 2 * 86400_000);
    const reminders = await prisma.subscription.findMany({
      where: {
        status: "TRIALING",
        trialEndsAt: { gte: reminderWindowStart, lte: reminderCutoff },
      },
      include: { merchant: true },
    });
    for (const sub of reminders) {
      await sendDunning({
        type: "trial_ending_soon",
        to: sub.merchant.ownerEmail,
        merchantName: sub.merchant.name,
        daysLeft: 3,
      });
      summary.trialReminders++;
    }

    // 2. Trial expired without payment method → PAST_DUE (read-only)
    const expiredTrials = await prisma.subscription.findMany({
      where: {
        status: "TRIALING",
        trialEndsAt: { lte: now },
      },
      include: { merchant: { include: { paymentMethod: true } } },
    });
    for (const sub of expiredTrials) {
      if (sub.merchant.paymentMethod) {
        // Card on file → just convert to ACTIVE, charge will run below
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: now },
        });
      } else {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "PAST_DUE" },
        });
        await sendDunning({
          type: "trial_expired",
          to: sub.merchant.ownerEmail,
          merchantName: sub.merchant.name,
        });
        summary.trialExpired++;
      }
    }

    // 3. Due ACTIVE subscriptions → charge RT
    const due = await prisma.subscription.findMany({
      where: { status: "ACTIVE", currentPeriodEnd: { lte: now } },
      include: { merchant: { include: { paymentMethod: true } } },
    });

    for (const sub of due) {
      const pm = sub.merchant.paymentMethod;
      if (!pm) continue;

      const { total } = computeVat(PLAN_PRICES_SAR[sub.plan]);
      try {
        const result = await chargeRegistration({
          rtId: pm.hyperpayRtId,
          amountSar: total.toFixed(2),
          channel: pm.brand === "MADA" ? "mada" : "card",
          merchantId: sub.merchantId,
        });

        if (result.success && result.hyperpayRefId) {
          // Webhook will create Charge — but in case of webhook delay, write idempotently
          const existing = await prisma.charge.findUnique({
            where: { hyperpayRefId: result.hyperpayRefId },
          });
          if (!existing) {
            const { amount, vat, total: t } = computeVat(PLAN_PRICES_SAR[sub.plan]);
            await prisma.charge.create({
              data: {
                merchantId: sub.merchantId,
                subscriptionId: sub.id,
                hyperpayRefId: result.hyperpayRefId,
                amountSar: amount.toString(),
                vatSar: vat.toString(),
                totalSar: t.toString(),
                status: "SUCCEEDED",
              },
            });
          }
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              status: "ACTIVE",
              currentPeriodStart: now,
              currentPeriodEnd: new Date(now.getTime() + 30 * 86400_000),
              retryCount: 0,
            },
          });
          summary.charged++;
        } else {
          await handleChargeFailure(sub, result.failureReason ?? "unknown");
          summary.failed++;
        }
      } catch (e) {
        Sentry.captureException(e, { extra: { merchantId: sub.merchantId } });
        await handleChargeFailure(sub, (e as Error).message);
        summary.failed++;
      }
    }

    // 4. Retry PAST_DUE that have a payment method
    const pastDue = await prisma.subscription.findMany({
      where: { status: "PAST_DUE", retryCount: { lt: MAX_RETRIES } },
      include: { merchant: { include: { paymentMethod: true } } },
    });

    for (const sub of pastDue) {
      const pm = sub.merchant.paymentMethod;
      if (!pm) continue;

      const { total } = computeVat(PLAN_PRICES_SAR[sub.plan]);
      const result = await chargeRegistration({
        rtId: pm.hyperpayRtId,
        amountSar: total.toFixed(2),
        channel: pm.brand === "MADA" ? "mada" : "card",
        merchantId: sub.merchantId,
      });

      if (result.success) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: "ACTIVE",
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 30 * 86400_000),
            retryCount: 0,
          },
        });
        summary.charged++;
      } else {
        await handleChargeFailure(sub, result.failureReason ?? "unknown");
      }
    }

    // 5. Cancel after MAX_RETRIES
    const exhausted = await prisma.subscription.findMany({
      where: { status: "PAST_DUE", retryCount: { gte: MAX_RETRIES } },
      include: { merchant: true },
    });
    for (const sub of exhausted) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "CANCELED", canceledAt: now },
      });
      await sendDunning({
        type: "subscription_canceled",
        to: sub.merchant.ownerEmail,
        merchantName: sub.merchant.name,
      });
      summary.canceled++;
    }

    return NextResponse.json({ ok: true, summary, ranAt: now.toISOString() });
  }

  async function handleChargeFailure(
    sub: { id: string; retryCount: number; merchantId: string; merchant: { ownerEmail: string; name: string } },
    reason: string,
  ) {
    const retry = sub.retryCount + 1;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "PAST_DUE", retryCount: retry },
    });
    await sendDunning({
      type: "payment_failed",
      to: sub.merchant.ownerEmail,
      merchantName: sub.merchant.name,
      retry,
      lastError: reason,
    });
  }
  ```

- [ ] Edit `vercel.json` (Plan 1) — add cron entry:

  ```json
  {
    "crons": [
      { "path": "/api/cron/billing", "schedule": "0 3 * * *" }
    ]
  }
  ```

  03:00 UTC = 06:00 KSA — outside business hours, before merchants open.

- [ ] Add an integration test (Vitest + sqlite or test schema) covering: trial reminder fires at d-3, trial expired with no PM goes PAST_DUE, charge retry increments counter, retry == 3 triggers cancel.
- [ ] **Commit:** `feat(billing): daily cron for trials, recurring charges, dunning, cancel`

---

## Task 16 — End-to-end happy path test (manual + scripted)

- [ ] Manual smoke test in sandbox:
  1. `bun dev`, sign up new merchant via Clerk
  2. Confirm `Subscription.status = TRIALING` in DB
  3. Visit `/ar/billing` → see "تجربة مجّانيّة" badge
  4. Click "متابعة" with mada channel → COPYandPAY widget loads
  5. Pay with `5360 2300 0000 0040` → 3DS challenge in sandbox
  6. Redirect to `/ar/billing/return?id=...` → finalize → Subscription = ACTIVE, PaymentMethod row created
  7. Trigger webhook manually: `curl -X POST localhost:3000/api/webhooks/hyperpay ...` with encrypted body → Charge row idempotent
  8. Trigger cron: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/billing` → returns summary JSON
  9. Verify enrollment is blocked when `prisma subscription update --status=PAST_DUE` is run

- [ ] Add `scripts/test-billing-e2e.ts` — programmatic version of the above using `undici` against a running dev server. CI-skippable; useful for staging verification.

- [ ] **Commit:** `chore(billing): e2e smoke test script + sandbox notes`

---

## Task 17 — Final hardening & docs

- [ ] Add Sentry context tags to all Hyperpay calls: `Sentry.setTag("hyperpay.channel", channel)`.
- [ ] Add `robots.txt` entries to disallow `/billing` from indexing (already covered if `robots.ts` exists from Plan 1; verify).
- [ ] Sanity-check the `Subscription.retryCount` reset — must reset to 0 on every successful charge (already done; add assertion test).
- [ ] Confirm CSP allows `https://*.oppwa.com` for the COPYandPAY script and form action — edit `next.config.ts` `headers()` if Plan 1 set strict CSP.
- [ ] Add a `Phase 2` section to README with explicit deferrals: ZATCA Phase 2 e-invoicing (XML + cryptographic stamps), overage billing (0.30 SAR/pass), Growth + Pro plans, refund flow, annual prepay (2 months free per spec §٩).

- [ ] **Commit:** `docs(billing): document Phase 2 deferrals (ZATCA, overage, plan tiers)`

---

## Acceptance Criteria

- [ ] New merchant signup → `TRIALING` subscription auto-created with `trialEndsAt = now + 14 days`.
- [ ] `/ar/billing` page renders for authenticated merchant with status, payment method, invoices.
- [ ] Sandbox checkout completes end-to-end: COPYandPAY widget → return URL → `Subscription = ACTIVE`, `PaymentMethod` persisted, `Charge` row created exactly once even if webhook fires after redirect (idempotency on `hyperpayRefId`).
- [ ] mada and Visa each route to the correct entityId; result is the same recorded `Charge`.
- [ ] `enrollCustomer` rejects with `EnrollmentBlockedError` when status ∈ {`PAST_DUE`, `CANCELED`} OR monthly pass count ≥ 300 (Starter).
- [ ] Daily cron at 03:00 UTC: sends d-3 reminder, expires trials with no PM, charges due ACTIVEs, retries PAST_DUE up to 3×, cancels on exhaustion. Endpoint requires `Bearer $CRON_SECRET`.
- [ ] Webhook decrypts AES-256-GCM payload using `HYPERPAY_WEBHOOK_KEY_HEX` + `X-Initialization-Vector` header. Tampered tag → 400.
- [ ] VAT math: 99 SAR base → 14.85 VAT → 113.85 total, displayed VAT-inclusive across UI.
- [ ] Invoice PDF renders Arabic with Noto Naskh, contains plan description + VAT breakdown + HyperPay ref.
- [ ] All tests green: `bun run test src/lib/billing src/lib/hyperpay`.
- [ ] No secrets committed. `HYPERPAY_*` variables documented in `.env.example`.

---

## Out of Scope (explicit handoff to other plans)

- Dashboard `/dashboard` KPIs (Plan 7)
- ZATCA Phase 2 e-invoicing — XML generation + cryptographic stamps + ZATCA portal submission
- Growth (249 SAR) + Pro (499 SAR) plans — gated on multi-program (Phase 2) and multi-location (Phase 3)
- Overage billing (0.30 SAR/pass beyond plan limit) — schema can support it; UX/backend deferred
- Annual prepay with 2 months free — deferred
- Refund admin UI — refunds done manually via HyperPay dashboard during MVP
- Saudi PDPL retention policy automation — privacy notice link only in MVP

---

## References

- HyperPay docs root: https://wordpresshyperpay.docs.oppwa.com/
- COPYandPAY widget: https://wordpresshyperpay.docs.oppwa.com/integrations/widget
- mada channel: https://wordpresshyperpay.docs.oppwa.com/integrations/widget/mada
- Recurring (RT/MIT): https://wordpresshyperpay.docs.oppwa.com/tutorials/integration-guide/recurring
- Webhooks (AES-GCM): https://wordpresshyperpay.docs.oppwa.com/tutorials/webhooks/integration
- Result codes: https://wordpresshyperpay.docs.oppwa.com/reference/resultCodes
- Test cards: https://wordpresshyperpay.docs.oppwa.com/reference/parameters#test-mode
- Vercel cron: https://vercel.com/docs/cron-jobs
- KSA VAT (15 %): https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx
