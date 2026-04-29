"use client";

type Props = { applePassUrl: string; googleWalletUrl: string; locale: string };

export function WalletButtons({ applePassUrl, googleWalletUrl, locale }: Props) {
  const isAr = locale === "ar";
  return (
    <div className="flex flex-col gap-3">
      <a
        href={applePassUrl}
        className="flex items-center justify-center gap-2 rounded-xl bg-black px-5 py-4 text-white shadow-sm active:scale-[0.98]"
        aria-label="Add to Apple Wallet"
      >
        <span>{isAr ? "أضف إلى Apple Wallet" : "Add to Apple Wallet"}</span>
      </a>
      <a
        href={googleWalletUrl}
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-black bg-white px-5 py-4 font-medium text-black active:scale-[0.98]"
        aria-label="Add to Google Wallet"
      >
        <span>{isAr ? "أضف إلى Google Wallet" : "Add to Google Wallet"}</span>
      </a>
    </div>
  );
}
