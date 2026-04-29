import { requireMerchant } from "@/lib/auth/current-merchant";
import { CardDesigner } from "../_components/CardDesigner";

export const dynamic = "force-dynamic";

export default async function NewCardPage() {
  const merchant = await requireMerchant();
  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Design your loyalty card</h1>
        <p className="text-muted-foreground">
          Customers will add this to their Apple or Google Wallet.
        </p>
      </header>
      <CardDesigner
        merchant={{
          name: merchant.name,
          logoUrl: merchant.logoUrl,
          brandColor: merchant.brandColor,
        }}
        mode="create"
      />
    </div>
  );
}
