import { OnboardingWizard } from "./_components/OnboardingWizard";
import { getCurrentMerchant } from "@/lib/auth/current-merchant";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const merchant = await getCurrentMerchant();

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-8">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to stampme</h1>
        <p className="text-muted-foreground">Let&rsquo;s set up your business in 3 quick steps.</p>
      </header>
      <OnboardingWizard
        initial={{
          name: merchant?.name ?? "",
          vertical: merchant?.vertical ?? "CAFE",
          logoUrl: merchant?.logoUrl ?? undefined,
          brandColor: merchant?.brandColor ?? "#0F172A",
        }}
      />
    </div>
  );
}
