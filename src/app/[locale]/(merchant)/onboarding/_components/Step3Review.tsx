"use client";

import { PassPreview } from "@/components/merchant/PassPreview";
import type { OnboardingState } from "./OnboardingWizard";

type Props = { state: OnboardingState };

export function Step3Review({ state }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Looking good — ready to finish?</h2>
        <p className="text-sm text-muted-foreground">
          You can change everything later from Settings.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-6 items-start">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Business</dt>
            <dd className="font-medium">{state.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Vertical</dt>
            <dd className="font-medium">{state.vertical}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Logo</dt>
            <dd className="font-medium">{state.logoUrl ? "Uploaded" : "—"}</dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-muted-foreground">Brand color</dt>
            <dd className="font-mono flex items-center gap-2">
              <span
                className="h-4 w-4 rounded border border-border"
                style={{ backgroundColor: state.brandColor }}
                aria-hidden
              />
              {state.brandColor}
            </dd>
          </div>
        </dl>
        <PassPreview
          merchantName={state.name || "Your business"}
          logoUrl={state.logoUrl}
          brandColor={state.brandColor}
          programName="Sample loyalty"
          stampsRequired={10}
          stampsCount={3}
          rewardLabel="Free coffee"
        />
      </div>
    </div>
  );
}
