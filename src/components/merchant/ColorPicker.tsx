"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESETS = [
  "#0F172A", "#1E40AF", "#0F766E", "#15803D", "#B45309",
  "#9F1239", "#7C3AED", "#0E7490", "#374151", "#000000",
];

type Props = {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  className?: string;
};

export function ColorPicker({ value, onChange, label = "Brand color", className }: Props) {
  const id = useId();
  return (
    <div className={cn("space-y-3", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-14 rounded-md border border-border cursor-pointer bg-transparent"
          aria-label={`${label} swatch`}
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            onChange(v.slice(0, 7).toUpperCase());
          }}
          maxLength={7}
          placeholder="#1A2B3C"
          className="font-mono w-32 uppercase"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color presets">
        {PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={value.toUpperCase() === hex.toUpperCase()}
            onClick={() => onChange(hex)}
            className={cn(
              "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
              value.toUpperCase() === hex.toUpperCase()
                ? "border-foreground ring-2 ring-offset-2 ring-foreground"
                : "border-border",
            )}
            style={{ backgroundColor: hex }}
            aria-label={`Use color ${hex}`}
          />
        ))}
      </div>
    </div>
  );
}
