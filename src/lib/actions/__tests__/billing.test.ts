import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — all vi.fn() instances must be created before imports
// ---------------------------------------------------------------------------
const {
  subscriptionFindUnique,
  subscriptionCreate,
  subscriptionUpdate,
  subscriptionUpsert,
  paymentMethodFindUnique,
  paymentMethodUpsert,
  chargeCreate,
  chargeUpdate,
} = vi.hoisted(() => ({
  subscriptionFindUnique: vi.fn(),
  subscriptionCreate: vi.fn(),
  subscriptionUpdate: vi.fn(),
  subscriptionUpsert: vi.fn(),
  paymentMethodFindUnique: vi.fn(),
  paymentMethodUpsert: vi.fn(),
  chargeCreate: vi.fn(),
  chargeUpdate: vi.fn(),
}));

const { requireMerchantMock } = vi.hoisted(() => ({
  requireMerchantMock: vi.fn(),
}));

const { myfatoorahRequestMock } = vi.hoisted(() => ({
  myfatoorahRequestMock: vi.fn(),
}));

const { authedLimiterMock } = vi.hoisted(() => ({
  authedLimiterMock: vi.fn(),
}));

const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}));

const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

// BILLING_AUTO_CHARGE_ENABLED is mutable per-test via envMock.BILLING_AUTO_CHARGE_ENABLED
const envMock = vi.hoisted(() => ({
  BILLING_AUTO_CHARGE_ENABLED: false,
  NEXT_PUBLIC_APP_URL: "https://app.test",
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({
  db: {
    subscription: {
      findUnique: subscriptionFindUnique,
      create: subscriptionCreate,
      update: subscriptionUpdate,
      upsert: subscriptionUpsert,
    },
    paymentMethod: {
      findUnique: paymentMethodFindUnique,
      upsert: paymentMethodUpsert,
    },
    charge: {
      create: chargeCreate,
      update: chargeUpdate,
    },
  },
}));

vi.mock("@/lib/auth/current-merchant", () => ({
  requireMerchant: requireMerchantMock,
}));

vi.mock("@/lib/myfatoorah/client", () => ({
  myfatoorahClient: { request: myfatoorahRequestMock },
}));

vi.mock("@/lib/ratelimit", () => ({
  authedMerchantLimiter: { limit: authedLimiterMock },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

// server-only is a compile-time guard; bypass it in tests
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Import SUT after all mocks are registered
// ---------------------------------------------------------------------------
import {
  startTrial,
  createCheckoutSession,
  applyPaymentResult,
  cancelSubscription,
  chargeRecurring,
} from "@/lib/actions/billing";

// Convenience: safely extract the first call's first argument from a vi.fn().
// Vitest types mock.calls as a jagged array; using `!` is correct in tests
// where the call count has been asserted or the test would fail otherwise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstCallArg(fn: ReturnType<typeof vi.fn>): any {
  return (fn.mock.calls[0] as unknown[])[0];
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const MERCHANT = {
  id: "m_1",
  name: "Test Merchant",
  ownerEmail: "owner@test.com",
  ownerPhone: "+966500000000",
};

const ALLOW = { success: true };
const DENY = { success: false };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: rate-limit allows
  authedLimiterMock.mockResolvedValue(ALLOW);
  // Default: requireMerchant returns MERCHANT
  requireMerchantMock.mockResolvedValue(MERCHANT);
  // Default: BILLING_AUTO_CHARGE_ENABLED=false
  envMock.BILLING_AUTO_CHARGE_ENABLED = false;
});

// ---------------------------------------------------------------------------
// startTrial
// ---------------------------------------------------------------------------
describe("startTrial", () => {
  it("creates new Subscription with TRIALING status and trialEndsAt = +14d", async () => {
    subscriptionFindUnique.mockResolvedValue(null);
    const createdSub = { id: "sub_new" };
    subscriptionCreate.mockResolvedValue(createdSub);

    const before = Date.now();
    const result = await startTrial("m_1");
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.subscriptionId).toBe("sub_new");

    const createCall = firstCallArg(subscriptionCreate);
    expect(createCall.data.merchantId).toBe("m_1");
    expect(createCall.data.plan).toBe("STARTER");
    expect(createCall.data.status).toBe("TRIALING");
    expect(createCall.data.provider).toBe("MYFATOORAH");

    const trialEndsAt = createCall.data.trialEndsAt as Date;
    const expectedMs = 14 * 24 * 60 * 60 * 1000;
    expect(trialEndsAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
    expect(trialEndsAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it("is idempotent — returns existing subscription without creating another", async () => {
    const existing = { id: "sub_existing" };
    subscriptionFindUnique.mockResolvedValue(existing);

    const result = await startTrial("m_1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.subscriptionId).toBe("sub_existing");
    expect(subscriptionCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------
describe("createCheckoutSession", () => {
  it("happy path — returns InvoiceURL + InvoiceId", async () => {
    subscriptionFindUnique.mockResolvedValue(null);
    myfatoorahRequestMock.mockResolvedValue({
      InvoiceId: 99001,
      InvoiceURL: "https://myfatoorah.com/pay/abc",
    });

    const result = await createCheckoutSession({ plan: "STARTER" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.paymentUrl).toBe("https://myfatoorah.com/pay/abc");
      expect(result.data?.invoiceId).toBe(99001);
    }
    expect(myfatoorahRequestMock).toHaveBeenCalledWith(
      "POST",
      "/v2/SendPayment",
      expect.objectContaining({
        body: expect.objectContaining({
          NotificationOption: "LNK",
          DisplayCurrencyIso: "SAR",
        }),
      }),
    );
  });

  it("returns error when rate-limited", async () => {
    authedLimiterMock.mockResolvedValue(DENY);

    const result = await createCheckoutSession({ plan: "STARTER" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too many/i);
    expect(myfatoorahRequestMock).not.toHaveBeenCalled();
  });

  it("returns error when merchant has no email", async () => {
    requireMerchantMock.mockResolvedValue({ ...MERCHANT, ownerEmail: null });

    const result = await createCheckoutSession({ plan: "STARTER" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/email missing/i);
    expect(myfatoorahRequestMock).not.toHaveBeenCalled();
  });

  it("returns error when plan is invalid", async () => {
    const result = await createCheckoutSession({ plan: "ENTERPRISE" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Invalid plan");
  });

  it("propagates MyFatoorahError with payment provider message", async () => {
    const { MyFatoorahError, MyFatoorahErrorCode } = await import(
      "@/lib/myfatoorah/types"
    );
    myfatoorahRequestMock.mockRejectedValue(
      new MyFatoorahError({
        code: MyFatoorahErrorCode.VALIDATION,
        message: "InvoiceValue invalid",
      }),
    );

    const result = await createCheckoutSession({ plan: "GROWTH" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/payment provider error/i);
  });
});

// ---------------------------------------------------------------------------
// applyPaymentResult
// ---------------------------------------------------------------------------
describe("applyPaymentResult", () => {
  const BASE_ARGS = { merchantId: "m_1", plan: "STARTER" as const, invoiceId: 12345 };

  it("activates subscription on Paid status", async () => {
    myfatoorahRequestMock.mockResolvedValue({
      InvoiceStatus: "Paid",
      InvoiceTransactions: [
        {
          TransactionStatus: "Succss", // MyFatoorah documented typo
          PaymentId: "pay_abc",
          RecurringId: null,
          CardNumber: null,
        },
      ],
    });
    subscriptionUpsert.mockResolvedValue({ id: "sub_1" });
    chargeCreate.mockResolvedValue({ id: "chg_1" });

    const result = await applyPaymentResult(BASE_ARGS);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.status).toBe("ACTIVE");

    const upsertCall = firstCallArg(subscriptionUpsert);
    expect(upsertCall.create.status).toBe("ACTIVE");
    expect(upsertCall.update.status).toBe("ACTIVE");
    expect(upsertCall.update.plan).toBe("STARTER");

    const chargeCall = firstCallArg(chargeCreate);
    expect(chargeCall.data.status).toBe("SUCCEEDED");
    expect(chargeCall.data.providerInvoiceId).toBe("12345");
    expect(chargeCall.data.providerPaymentId).toBe("pay_abc");
  });

  it("saves PaymentMethod when RecurringId is present", async () => {
    myfatoorahRequestMock.mockResolvedValue({
      InvoiceStatus: "Paid",
      InvoiceTransactions: [
        {
          TransactionStatus: "Succss",
          PaymentId: "pay_xyz",
          RecurringId: "rec_tok_1",
          CardNumber: "4111111111111234",
          CardBrand: "VISA",
          ExpiryMonth: "12",
          ExpiryYear: "2028",
          HolderName: "Test User",
        },
      ],
    });
    subscriptionUpsert.mockResolvedValue({ id: "sub_1" });
    chargeCreate.mockResolvedValue({ id: "chg_1" });
    paymentMethodUpsert.mockResolvedValue({ id: "pm_1" });

    await applyPaymentResult(BASE_ARGS);

    expect(paymentMethodUpsert).toHaveBeenCalledOnce();
    const pmCall = firstCallArg(paymentMethodUpsert);
    expect(pmCall.create.recurringId).toBe("rec_tok_1");
    expect(pmCall.create.last4).toBe("1234");
    expect(pmCall.create.brand).toBe("VISA");
    expect(pmCall.create.expMonth).toBe(12);
    expect(pmCall.create.expYear).toBe(2028);
    expect(pmCall.create.holderName).toBe("Test User");
  });

  it("logs FAILED charge when InvoiceStatus is not Paid", async () => {
    myfatoorahRequestMock.mockResolvedValue({ InvoiceStatus: "Failed" });
    subscriptionFindUnique.mockResolvedValue({ id: "sub_existing" });
    chargeCreate.mockResolvedValue({ id: "chg_fail" });

    const result = await applyPaymentResult(BASE_ARGS);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.status).toBe("FAILED");

    expect(chargeCreate).toHaveBeenCalledOnce();
    const chargeCall = firstCallArg(chargeCreate);
    expect(chargeCall.data.status).toBe("FAILED");
    expect(chargeCall.data.failureReason).toBe("InvoiceStatus=Failed");
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cancelSubscription
// ---------------------------------------------------------------------------
describe("cancelSubscription", () => {
  it("flips status to CANCELED and calls CancelRecurringPayment", async () => {
    subscriptionFindUnique.mockResolvedValue({ id: "sub_1", merchantId: "m_1" });
    subscriptionUpdate.mockResolvedValue({ id: "sub_1", status: "CANCELED" });
    paymentMethodFindUnique.mockResolvedValue({ id: "pm_1", recurringId: "rec_abc" });
    myfatoorahRequestMock.mockResolvedValue({});

    const result = await cancelSubscription();

    expect(result.ok).toBe(true);

    const updateCall = firstCallArg(subscriptionUpdate);
    expect(updateCall.data.status).toBe("CANCELED");
    expect(updateCall.where.merchantId).toBe("m_1");

    expect(myfatoorahRequestMock).toHaveBeenCalledWith(
      "POST",
      "/v2/CancelRecurringPayment",
      expect.objectContaining({
        body: { RecurringId: "rec_abc" },
      }),
    );

    expect(revalidatePathMock).toHaveBeenCalledWith("/ar/settings");
    expect(revalidatePathMock).toHaveBeenCalledWith("/en/settings");
  });

  it("still cancels successfully even if CancelRecurringPayment throws", async () => {
    subscriptionFindUnique.mockResolvedValue({ id: "sub_1", merchantId: "m_1" });
    subscriptionUpdate.mockResolvedValue({ id: "sub_1", status: "CANCELED" });
    paymentMethodFindUnique.mockResolvedValue({ id: "pm_1", recurringId: "rec_abc" });
    myfatoorahRequestMock.mockRejectedValue(new Error("Provider timeout"));

    const result = await cancelSubscription();

    expect(result.ok).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });

  it("returns error when rate-limited", async () => {
    authedLimiterMock.mockResolvedValue(DENY);

    const result = await cancelSubscription();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too many/i);
  });

  it("returns error when no subscription found", async () => {
    subscriptionFindUnique.mockResolvedValue(null);

    const result = await cancelSubscription();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no active subscription/i);
  });
});

// ---------------------------------------------------------------------------
// chargeRecurring
// ---------------------------------------------------------------------------
describe("chargeRecurring", () => {
  it("is rejected when BILLING_AUTO_CHARGE_ENABLED=false", async () => {
    envMock.BILLING_AUTO_CHARGE_ENABLED = false;

    const result = await chargeRecurring("sub_1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/auto-charge disabled/i);
    expect(subscriptionFindUnique).not.toHaveBeenCalled();
  });

  it("succeeds → updates subscription ACTIVE + charge SUCCEEDED when flag=true", async () => {
    envMock.BILLING_AUTO_CHARGE_ENABLED = true;

    subscriptionFindUnique.mockResolvedValue({
      id: "sub_1",
      merchantId: "m_1",
      plan: "STARTER",
      merchant: { ownerEmail: "owner@test.com" },
    });
    paymentMethodFindUnique.mockResolvedValue({ recurringId: "rec_tok_1" });
    chargeCreate.mockResolvedValue({ id: "chg_1" });
    myfatoorahRequestMock.mockResolvedValue({
      InvoiceId: 55001,
      PaymentId: "pay_r1",
      InvoiceStatus: "Paid",
    });
    chargeUpdate.mockResolvedValue({});
    subscriptionUpdate.mockResolvedValue({});

    const result = await chargeRecurring("sub_1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.chargeId).toBe("chg_1");
      expect(result.data?.status).toBe("SUCCEEDED");
    }

    const chargeUpdateCall = firstCallArg(chargeUpdate);
    expect(chargeUpdateCall.data.status).toBe("SUCCEEDED");
    expect(chargeUpdateCall.data.succeededAt).toBeInstanceOf(Date);

    const subUpdateCall = firstCallArg(subscriptionUpdate);
    expect(subUpdateCall.data.status).toBe("ACTIVE");
    expect(subUpdateCall.data.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it("marks PAST_DUE + charge FAILED when InvoiceStatus != Paid (flag=true)", async () => {
    envMock.BILLING_AUTO_CHARGE_ENABLED = true;

    subscriptionFindUnique.mockResolvedValue({
      id: "sub_1",
      merchantId: "m_1",
      plan: "GROWTH",
      merchant: { ownerEmail: "owner@test.com" },
    });
    paymentMethodFindUnique.mockResolvedValue({ recurringId: "rec_tok_2" });
    chargeCreate.mockResolvedValue({ id: "chg_2" });
    myfatoorahRequestMock.mockResolvedValue({
      InvoiceId: 55002,
      PaymentId: "pay_r2",
      InvoiceStatus: "Failed",
    });
    chargeUpdate.mockResolvedValue({});
    subscriptionUpdate.mockResolvedValue({});

    const result = await chargeRecurring("sub_1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.status).toBe("FAILED");

    const chargeUpdateCall = firstCallArg(chargeUpdate);
    expect(chargeUpdateCall.data.status).toBe("FAILED");
    expect(chargeUpdateCall.data.failureReason).toBe("Failed");

    const subUpdateCall = firstCallArg(subscriptionUpdate);
    expect(subUpdateCall.data.status).toBe("PAST_DUE");
  });

  it("marks PAST_DUE + charge FAILED when client throws (flag=true)", async () => {
    envMock.BILLING_AUTO_CHARGE_ENABLED = true;

    subscriptionFindUnique.mockResolvedValue({
      id: "sub_1",
      merchantId: "m_1",
      plan: "PRO",
      merchant: { ownerEmail: "owner@test.com" },
    });
    paymentMethodFindUnique.mockResolvedValue({ recurringId: "rec_tok_3" });
    chargeCreate.mockResolvedValue({ id: "chg_3" });
    myfatoorahRequestMock.mockRejectedValue(new Error("Network error"));
    chargeUpdate.mockResolvedValue({});
    subscriptionUpdate.mockResolvedValue({});

    const result = await chargeRecurring("sub_1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Charge failed");

    const chargeUpdateCall = firstCallArg(chargeUpdate);
    expect(chargeUpdateCall.data.status).toBe("FAILED");
    expect(chargeUpdateCall.data.failureReason).toBe("Network error");

    const subUpdateCall = firstCallArg(subscriptionUpdate);
    expect(subUpdateCall.data.status).toBe("PAST_DUE");

    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });

  it("returns error when no saved payment method (flag=true)", async () => {
    envMock.BILLING_AUTO_CHARGE_ENABLED = true;

    subscriptionFindUnique.mockResolvedValue({
      id: "sub_1",
      merchantId: "m_1",
      plan: "STARTER",
      merchant: { ownerEmail: "owner@test.com" },
    });
    paymentMethodFindUnique.mockResolvedValue(null);

    const result = await chargeRecurring("sub_1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no saved payment method/i);
  });
});
