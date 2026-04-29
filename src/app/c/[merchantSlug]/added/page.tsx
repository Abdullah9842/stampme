import { notFound } from "next/navigation";
import Image from "next/image";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const locale = "ar" as const;

export default async function AddedPage({
  params,
}: {
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const merchant = await db.merchant.findUnique({
    where: { slug: merchantSlug },
    select: { name: true, logoUrl: true },
  });
  if (!merchant) notFound();
  const isAr = locale === "ar";

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-5 pb-16 pt-12 text-center">
      <div
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-full"
        style={{
          backgroundColor: "color-mix(in srgb, var(--brand) 20%, transparent)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-9 w-9"
          style={{ fill: "var(--brand)" }}
        >
          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19l12-12-1.4-1.4z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold">
        {isAr
          ? "تمّت إضافة الكرت إلى محفظتك!"
          : "Pass added to your wallet!"}
      </h1>
      {merchant.logoUrl ? (
        <Image
          src={merchant.logoUrl}
          alt={merchant.name}
          width={64}
          height={64}
          className="my-4 rounded-xl object-contain"
          unoptimized
        />
      ) : null}
      <p className="mt-3 text-base text-neutral-700">
        {isAr
          ? "في زيارتك القادمة، أظهر الكرت عند الكاشير لإضافة ختم."
          : "On your next visit, show this pass at the cashier to collect a stamp."}
      </p>
      <ol className="mt-6 space-y-2 text-start text-sm text-neutral-600">
        <li>
          {isAr
            ? "١. افتح Apple Wallet أو Google Wallet"
            : "1. Open Apple Wallet or Google Wallet"}
        </li>
        <li>
          {isAr
            ? "٢. أظهر الكرت عند الكاشير"
            : "2. Show the card at the cashier"}
        </li>
        <li>
          {isAr
            ? "٣. الكرت يتحدّث تلقائياً"
            : "3. Your card updates automatically"}
        </li>
      </ol>
    </main>
  );
}
