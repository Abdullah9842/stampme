import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { RecoverForm } from "./_RecoverForm";

export const dynamic = "force-dynamic";

const locale = "ar" as const;

export default async function RecoverPage({
  params,
}: {
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const merchant = await db.merchant.findUnique({
    where: { slug: merchantSlug },
    select: { name: true },
  });
  if (!merchant) notFound();
  const isAr = locale === "ar";

  return (
    <main className="mx-auto max-w-md px-5 pb-16 pt-12">
      <h1 className="text-2xl font-bold text-center">
        {isAr ? "استرجاع كرت الولاء" : "Recover your loyalty card"}
      </h1>
      <p className="mt-3 text-center text-sm text-neutral-600">
        {isAr
          ? `أدخل الرقم الذي استخدمته في ${merchant.name}`
          : `Enter the phone you used at ${merchant.name}`}
      </p>
      <div className="mt-8">
        <RecoverForm merchantSlug={merchantSlug} locale={locale} />
      </div>
    </main>
  );
}
