"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Stepper } from "@/components/merchant/Stepper";
import { Button } from "@/components/ui/button";
import { Step1Business } from "./Step1Business";
import { Step2Branding } from "./Step2Branding";
import { Step3Review } from "./Step3Review";
import { finishOnboarding } from "@/lib/actions/onboarding";
import type { Vertical } from "@/lib/validation/merchant";

const STEPS = [
  { id: 1, label: "Business" },
  { id: 2, label: "Branding" },
  { id: 3, label: "Review" },
];

export type OnboardingState = {
  name: string;
  vertical: Vertical;
  logoUrl?: string;
  brandColor: string;
};

type Props = {
  initial: OnboardingState;
};

export function OnboardingWizard({ initial }: Props) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<OnboardingState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const canNext =
    (step === 1 && state.name.trim().length >= 2) ||
    (step === 2 && /^#[0-9a-fA-F]{6}$/.test(state.brandColor)) ||
    step === 3;

  function handleFinish() {
    setError(null);
    startTransition(async () => {
      const result = await finishOnboarding({
        name: state.name,
        vertical: state.vertical,
        brandColor: state.brandColor,
        logoUrl: state.logoUrl,
        acceptedTerms: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/cards/new");
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <Stepper steps={STEPS} current={step} />

      <div className="bg-card border border-border rounded-xl p-6">
        {step === 1 && (
          <Step1Business
            value={{ name: state.name, vertical: state.vertical }}
            onChange={(v) => setState((s) => ({ ...s, ...v }))}
          />
        )}
        {step === 2 && (
          <Step2Branding
            value={{ logoUrl: state.logoUrl, brandColor: state.brandColor }}
            onChange={(v) => setState((s) => ({ ...s, ...v }))}
          />
        )}
        {step === 3 && <Step3Review state={state} />}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive text-center">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || isPending}
        >
          Back
        </Button>
        {step < 3 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Continue
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={isPending}>
            {isPending ? "Finishing..." : "Finish & design my card"}
          </Button>
        )}
      </div>
    </div>
  );
}
