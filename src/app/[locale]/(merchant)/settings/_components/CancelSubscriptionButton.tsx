"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cancelSubscription } from "@/lib/actions/billing";

export function CancelSubscriptionButton({ locale }: { locale: string }) {
  const isAr = locale === "ar";
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelSubscription();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.reload();
    });
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        className="text-muted-foreground"
      >
        {isAr ? "إلغاء الاشتراك" : "Cancel subscription"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <p className="text-sm">{isAr ? "متأكد؟" : "Sure?"}</p>
      <Button variant="destructive" size="sm" onClick={doCancel} disabled={pending}>
        {pending ? (isAr ? "جاري الإلغاء..." : "Canceling...") : (isAr ? "نعم، ألغِ" : "Yes, cancel")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        {isAr ? "تراجع" : "Back"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
