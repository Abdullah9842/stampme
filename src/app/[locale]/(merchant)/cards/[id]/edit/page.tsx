import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMerchant } from "@/lib/auth/current-merchant";
import { CardDesigner } from "../../_components/CardDesigner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; locale: string }> };

export default async function EditCardPage({ params }: Params) {
  const { id } = await params;
  const merchant = await requireMerchant();

  const program = await db.loyaltyProgram.findFirst({
    where: { id, merchantId: merchant.id },
  });
  if (!program) notFound();

  return (
    <div className="max-w-5xl mx-auto py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Edit loyalty card</h1>
        <p className="text-muted-foreground">Changes apply to new passes immediately.</p>
      </header>
      <CardDesigner
        merchant={{
          name: merchant.name,
          logoUrl: merchant.logoUrl,
          brandColor: merchant.brandColor,
        }}
        mode="edit"
        card={{
          id: program.id,
          programName: program.name,
          stampsRequired: program.stampsRequired,
          rewardLabel: program.rewardLabel,
        }}
      />
    </div>
  );
}
