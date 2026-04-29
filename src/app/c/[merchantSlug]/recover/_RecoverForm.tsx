"use client";

import { useState, useTransition } from "react";
import { recoverPass } from "@/lib/actions/enrollment";
import { WalletButtons } from "../_components/WalletButtons";

export function RecoverForm({
  merchantSlug,
  locale,
}: {
  merchantSlug: string;
  locale: string;
}) {
  const isAr = locale === "ar";
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{
    applePassUrl: string;
    googleWalletUrl: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await recoverPass({ merchantSlug, phone });
      if (!res.ok) {
        setError(
          res.code === "RATE_LIMITED"
            ? isAr
              ? "محاولات كثيرة، حاول بعد ساعة"
              : "Too many attempts, try in 1h"
            : res.code === "NOT_FOUND"
              ? isAr
                ? "لا يوجد كرت بهذا الرقم"
                : "No card found for this number"
              : isAr
                ? "حصل خطأ"
                : "Error",
        );
        return;
      }
      setFound({
        applePassUrl: res.applePassUrl,
        googleWalletUrl: res.googleWalletUrl,
      });
    });
  }

  if (found) return <WalletButtons {...found} locale={locale} />;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex items-stretch overflow-hidden rounded-xl border-2 border-neutral-200 bg-white">
        <span className="flex items-center bg-neutral-50 px-3 text-sm text-neutral-600">
          +966
        </span>
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
        className="rounded-xl px-5 py-4 text-white font-medium disabled:opacity-60"
        style={{ backgroundColor: "var(--brand)" }}
      >
        {pending
          ? isAr
            ? "بحث..."
            : "Searching..."
          : isAr
            ? "استرجاع الكرت"
            : "Recover card"}
      </button>
    </form>
  );
}
