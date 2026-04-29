import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PassPreview } from "@/components/merchant/PassPreview";
import { EnrollmentForm } from "./_components/EnrollmentForm";

export const dynamic = "force-dynamic";

type Search = { sig?: string; exp?: string };

const locale = "ar" as const;

export default async function CustomerEnrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantSlug: string }>;
  searchParams: Promise<Search>;
}) {
  const { merchantSlug } = await params;
  const sp = await searchParams;

  const merchant = await db.merchant.findUnique({
    where: { slug: merchantSlug },
    include: {
      programs: {
        where: { passKitProgramId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!merchant || merchant.programs.length === 0) notFound();
  const program = merchant.programs[0]!;

  const headlineAr = `اجمع ${program.stampsRequired} ختمات، خذ ${program.rewardLabel} مجاناً`;

  return (
    <main className="mx-auto max-w-md px-5 pb-12 pt-10">
      <header className="flex flex-col items-center text-center">
        {merchant.logoUrl ? (
          <Image
            src={merchant.logoUrl}
            alt={merchant.name}
            width={88}
            height={88}
            className="mb-3 rounded-2xl object-contain"
            unoptimized
          />
        ) : (
          <div className="mb-3 flex h-22 w-22 items-center justify-center rounded-2xl bg-neutral-100 text-2xl font-bold">
            {merchant.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-bold text-neutral-900">{merchant.name}</h1>
        <p className="mt-3 text-lg text-neutral-700">{headlineAr}</p>
      </header>

      <div className="my-8">
        <PassPreview
          merchantName={merchant.name}
          logoUrl={merchant.logoUrl}
          brandColor={merchant.brandColor}
          programName={program.name}
          stampsRequired={program.stampsRequired}
          rewardLabel={program.rewardLabel}
          stampsCount={0}
        />
      </div>

      <EnrollmentForm
        merchantSlug={merchantSlug}
        sig={sp.sig}
        exp={sp.exp ? Number(sp.exp) : undefined}
        locale={locale}
      />
    </main>
  );
}
