import { db } from "@/lib/db";
import { PLAN_CONFIG, priceWithVat, TRIAL_DAYS } from "@/lib/billing/plans";
import { isSubscriptionActive, isTrialExpired } from "@/lib/billing/status";
import { SubscribeButtons } from "./SubscribeButtons";
import { CancelSubscriptionButton } from "./CancelSubscriptionButton";

export async function SubscriptionSection({ merchantId, locale }: { merchantId: string; locale: string }) {
  const sub = await db.subscription.findUnique({ where: { merchantId } });
  const pm = await db.paymentMethod.findUnique({ where: { merchantId } });
  const isAr = locale === "ar";

  const heading = isAr ? "الاشتراك" : "Subscription";

  if (!sub) {
    return (
      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <p className="text-sm text-muted-foreground">
          {isAr ? "ما عندك اشتراك. ابدأ تجربة مجانية 14 يوم." : "No subscription. Start a 14-day free trial."}
        </p>
        <SubscribeButtons locale={locale} />
      </section>
    );
  }

  const planConfig = PLAN_CONFIG[sub.plan];
  const planLabel = isAr ? planConfig.displayNameAr : planConfig.displayNameEn;

  let statusBadge: React.ReactNode;
  let statusMessage: string;
  if (sub.status === "TRIALING") {
    const daysLeft = sub.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : TRIAL_DAYS;
    statusBadge = (
      <span className="inline-block px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 text-xs font-medium">
        {isAr ? `تجربة • متبقي ${daysLeft} يوم` : `Trial • ${daysLeft} days left`}
      </span>
    );
    statusMessage = isAr
      ? `بعد انتهاء التجربة، ستحتاج تفعيل الاشتراك (${planLabel} • ${priceWithVat(sub.plan)} ريال شامل الضريبة)`
      : `After trial ends, activate ${planLabel} • ${priceWithVat(sub.plan)} SAR/mo (incl. VAT)`;
  } else if (sub.status === "ACTIVE") {
    statusBadge = (
      <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-medium">
        {isAr ? "نشط" : "Active"}
      </span>
    );
    statusMessage = isAr
      ? `${planLabel} • ${priceWithVat(sub.plan)} ريال شهرياً • التجديد: ${sub.currentPeriodEnd.toLocaleDateString("ar")}`
      : `${planLabel} • ${priceWithVat(sub.plan)} SAR/mo • Renews: ${sub.currentPeriodEnd.toLocaleDateString("en")}`;
  } else if (sub.status === "PAST_DUE") {
    statusBadge = (
      <span className="inline-block px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 text-xs font-medium">
        {isAr ? "الدفع متأخر" : "Past Due"}
      </span>
    );
    statusMessage = isAr ? "فشلت آخر محاولة دفع. حدّث طريقة الدفع." : "Last charge failed. Update your payment method.";
  } else {
    // CANCELED, EXPIRED
    statusBadge = (
      <span className="inline-block px-3 py-1 rounded-full bg-neutral-500/10 text-neutral-600 text-xs font-medium">
        {isAr ? "ملغي" : "Canceled"}
      </span>
    );
    statusMessage = isAr ? "اشتراكك ملغي. اشترك من جديد:" : "Subscription canceled. Subscribe again:";
  }

  const showSubscribe = sub.status === "TRIALING" || sub.status === "PAST_DUE" || sub.status === "CANCELED" || isTrialExpired(sub);
  const showCancel = isSubscriptionActive(sub);

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{heading}</h2>
        {statusBadge}
      </div>
      <p className="text-sm text-muted-foreground">{statusMessage}</p>

      {pm && (
        <p className="text-xs text-muted-foreground">
          {isAr ? "بطاقة" : "Card"}: {pm.brand} •••• {pm.last4} (
          {pm.expMonth.toString().padStart(2, "0")}/{pm.expYear})
        </p>
      )}

      {showSubscribe && <SubscribeButtons locale={locale} />}
      {showCancel && <CancelSubscriptionButton locale={locale} />}
    </section>
  );
}
