"use client";

import { useState, useTransition } from "react";
import { createCheckoutSession } from "@/lib/actions/billing";
import { PLAN_CONFIG, priceWithVat } from "@/lib/billing/plans";
import type { Plan } from "@prisma/client";

const PLANS: Plan[] = ["STARTER", "GROWTH", "PRO"];

export function SubscribeButtons({ locale }: { locale: string }) {
  const isAr = locale === "ar";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);

  function subscribe(plan: Plan) {
    setError(null);
    setActivePlan(plan);
    startTransition(async () => {
      const res = await createCheckoutSession({ plan });
      if (!res.ok) {
        setError(res.error);
        setActivePlan(null);
        return;
      }
      if (res.data?.paymentUrl) {
        window.location.href = res.data.paymentUrl;
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PLANS.map((plan) => {
          const cfg = PLAN_CONFIG[plan];
          const label = isAr ? cfg.displayNameAr : cfg.displayNameEn;
          return (
            <button
              key={plan}
              type="button"
              onClick={() => subscribe(plan)}
              disabled={pending}
              className="rounded-xl border-2 border-border hover:border-primary p-4 text-start transition-colors disabled:opacity-50"
            >
              <div className="font-semibold">{label}</div>
              <div className="text-xl font-bold mt-1">{priceWithVat(plan)} ريال</div>
              <div className="text-xs text-muted-foreground mt-1">
                {cfg.passQuotaPerMonth} {isAr ? "كرت/شهر" : "passes/mo"}
              </div>
              {pending && activePlan === plan && (
                <div className="text-xs mt-2">{isAr ? "جاري التحويل..." : "Redirecting..."}</div>
              )}
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
