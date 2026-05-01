import { requireMerchant } from "@/lib/auth/current-merchant";
import { db } from "@/lib/db";
import { ProfileForm } from "./_components/ProfileForm";
import { StaffPinForm } from "./_components/StaffPinForm";
import { SlugCard } from "./_components/SlugCard";
import { SubscriptionSection } from "./_components/SubscriptionSection";

export const dynamic = "force-dynamic";

type Search = { billing?: string };

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const isAr = locale === "ar";

  const merchant = await requireMerchant();
  const pinExists = await db.staffPin.findFirst({
    where: { merchantId: merchant.id },
    select: { id: true },
  });

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your business profile and staff access.</p>
      </header>

      {sp.billing === "success" && (
        <div className="rounded-lg bg-emerald-500/10 text-emerald-600 px-4 py-3 text-sm">
          {isAr ? "تم تفعيل الاشتراك بنجاح" : "Subscription activated"}
        </div>
      )}
      {sp.billing === "failed" && (
        <div className="rounded-lg bg-red-500/10 text-red-600 px-4 py-3 text-sm">
          {isAr ? "فشل الدفع. حاول مرة أخرى." : "Payment failed. Try again."}
        </div>
      )}
      {sp.billing === "error" && (
        <div className="rounded-lg bg-amber-500/10 text-amber-600 px-4 py-3 text-sm">
          {isAr ? "حصل خطأ. تواصل معنا." : "Something went wrong. Contact us."}
        </div>
      )}

      <SubscriptionSection merchantId={merchant.id} locale={locale} />

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Business profile</h2>
        <ProfileForm
          merchant={{
            id: merchant.id,
            name: merchant.name,
            vertical: merchant.vertical,
            logoUrl: merchant.logoUrl,
            brandColor: merchant.brandColor,
          }}
        />
      </section>

      <SlugCard slug={merchant.slug} />

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Staff PIN</h2>
        <p className="text-sm text-muted-foreground">
          Cashiers enter this 4-digit PIN to access the scanner. One PIN per business for now.
        </p>
        <StaffPinForm hasExistingPin={Boolean(pinExists)} />
      </section>
    </div>
  );
}
