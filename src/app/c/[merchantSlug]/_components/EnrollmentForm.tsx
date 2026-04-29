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
            ? isAr
              ? "محاولات كثيرة، حاول لاحقاً"
              : "Too many attempts, try later"
            : res.code === "VALIDATION"
              ? res.message
              : isAr
                ? "حصل خطأ، جرّب مرة ثانية"
                : "Something went wrong",
        );
        return;
      }
      setIssued({
        applePassUrl: res.applePassUrl,
        googleWalletUrl: res.googleWalletUrl,
      });
      router.prefetch(`/c/${merchantSlug}/added`);
    });
  }

  if (issued) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-center text-base text-neutral-700">
          {isAr
            ? "ممتاز! اضغط الزرّ المناسب لجوّالك:"
            : "Great! Tap the button for your phone:"}
        </p>
        <WalletButtons {...issued} locale={locale} />
        <a
          href={`/c/${merchantSlug}/added`}
          className="mt-2 text-center text-sm underline"
          style={{ color: "var(--brand)" }}
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
      <div className="flex items-stretch overflow-hidden rounded-xl border-2 border-neutral-200 bg-white">
        <span className="flex items-center bg-neutral-50 px-3 text-sm text-neutral-600">
          +966
        </span>
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
        className="rounded-xl px-5 py-4 text-white font-medium shadow-sm active:scale-[0.98] disabled:opacity-60"
        style={{ backgroundColor: "var(--brand)" }}
      >
        {pending
          ? isAr
            ? "جاري الإصدار..."
            : "Issuing..."
          : isAr
            ? "احصل على كرت الولاء"
            : "Get your loyalty card"}
      </button>
      <p className="text-center text-xs text-neutral-500">
        {isAr
          ? "بإصدارك للكرت توافق على شروط الخدمة"
          : "By continuing you accept the terms"}
      </p>
    </form>
  );
}
