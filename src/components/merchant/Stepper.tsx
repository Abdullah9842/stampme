"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type StepperStep = {
  id: number;
  label: string;
};

type Props = {
  steps: StepperStep[];
  current: number; // 1-indexed
  className?: string;
};

export function Stepper({ steps, current, className }: Props) {
  return (
    <ol
      className={cn("flex items-center justify-between gap-2 w-full", className)}
      aria-label="Onboarding progress"
    >
      {steps.map((step, i) => {
        const isDone = step.id < current;
        const isActive = step.id === current;
        return (
          <li key={step.id} className="flex-1 flex items-center gap-2">
            <div
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border transition-colors",
                isDone && "bg-primary text-primary-foreground border-primary",
                isActive && "bg-primary/10 text-primary border-primary",
                !isDone && !isActive && "bg-muted text-muted-foreground border-border",
              )}
            >
              {isDone ? <Check className="h-4 w-4" aria-hidden /> : step.id}
            </div>
            <span
              className={cn(
                "text-sm hidden sm:inline",
                isActive ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-px mx-2 transition-colors",
                  isDone ? "bg-primary" : "bg-border",
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
