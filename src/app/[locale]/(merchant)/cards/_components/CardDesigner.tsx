"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { PassPreview } from "@/components/merchant/PassPreview";
import { createCard, updateCard } from "@/lib/actions/cards";
import { createCardSchema } from "@/lib/validation/card";

type MerchantSummary = {
  name: string;
  logoUrl: string | null;
  brandColor: string;
};

type Props =
  | {
      merchant: MerchantSummary;
      mode: "create";
    }
  | {
      merchant: MerchantSummary;
      mode: "edit";
      card: {
        id: string;
        programName: string;
        stampsRequired: number;
        rewardLabel: string;
      };
    };

export function CardDesigner(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial =
    props.mode === "edit"
      ? props.card
      : { id: undefined, programName: "Loyalty card", stampsRequired: 10, rewardLabel: "Free coffee" };

  const [programName, setProgramName] = useState(initial.programName);
  const [stampsRequired, setStampsRequired] = useState(initial.stampsRequired);
  const [rewardLabel, setRewardLabel] = useState(initial.rewardLabel);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createCardSchema.safeParse({
      programName,
      stampsRequired,
      rewardLabel,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(", "));
      return;
    }

    startTransition(async () => {
      const result =
        props.mode === "edit"
          ? await updateCard({
              id: props.card.id,
              programName,
              stampsRequired,
              rewardLabel,
            })
          : await createCard({ programName, stampsRequired, rewardLabel });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid lg:grid-cols-2 gap-8">
      <section className="space-y-6 bg-card border border-border rounded-xl p-6">
        <div className="space-y-2">
          <Label htmlFor="program-name">Program name</Label>
          <Input
            id="program-name"
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            maxLength={60}
            placeholder="Coffee Lovers"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="stamps">Stamps required</Label>
            <span className="text-sm font-mono">{stampsRequired}</span>
          </div>
          <Slider
            id="stamps"
            min={5}
            max={20}
            step={1}
            value={[stampsRequired]}
            onValueChange={(v) => setStampsRequired(v[0] ?? 10)}
          />
          <p className="text-xs text-muted-foreground">Between 5 and 20 stamps.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reward">Reward label</Label>
          <Input
            id="reward"
            value={rewardLabel}
            onChange={(e) => setRewardLabel(e.target.value)}
            maxLength={50}
            placeholder="Free coffee — قهوة مجانية"
            required
          />
          <p className="text-xs text-muted-foreground">
            {rewardLabel.length}/50 — show both Arabic and English here for now.
          </p>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending
              ? "Saving..."
              : props.mode === "edit"
                ? "Save changes"
                : "Create card"}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-sm text-muted-foreground text-center">Live preview</p>
        <PassPreview
          merchantName={props.merchant.name}
          logoUrl={props.merchant.logoUrl}
          brandColor={props.merchant.brandColor}
          programName={programName || "Your program"}
          stampsRequired={stampsRequired}
          stampsCount={Math.min(3, stampsRequired)}
          rewardLabel={rewardLabel || "Reward"}
        />
      </section>
    </form>
  );
}
