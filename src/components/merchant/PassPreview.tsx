"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type Props = {
  merchantName: string;
  logoUrl?: string | null;
  brandColor: string;
  programName: string;
  stampsRequired: number;
  stampsCount?: number;
  rewardLabel: string;
  className?: string;
};

function getContrastTextColor(hex: string): "#ffffff" | "#0f172a" {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // YIQ luminance
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y >= 160 ? "#0f172a" : "#ffffff";
}

export function PassPreview({
  merchantName,
  logoUrl,
  brandColor,
  programName,
  stampsRequired,
  stampsCount = 0,
  rewardLabel,
  className,
}: Props) {
  const fg = getContrastTextColor(brandColor);
  const stamps = Array.from({ length: stampsRequired }, (_, i) => i < stampsCount);

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[340px] rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/10",
        className,
      )}
      style={{ backgroundColor: brandColor, color: fg }}
      role="img"
      aria-label={`Apple Wallet preview for ${merchantName}`}
    >
      <div className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <div className="relative h-10 w-10 rounded-md bg-white/95 p-1">
              <Image
                src={logoUrl}
                alt={`${merchantName} logo`}
                fill
                sizes="40px"
                className="object-contain"
                unoptimized={logoUrl.endsWith(".svg")}
              />
            </div>
          ) : (
            <div
              className="h-10 w-10 rounded-md bg-white/15 flex items-center justify-center text-xs font-semibold"
              aria-hidden
            >
              {merchantName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="text-sm font-semibold tracking-tight truncate max-w-[180px]">
            {merchantName}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest opacity-70">Loyalty</span>
      </div>

      <div className="px-5 pb-2">
        <p className="text-xs uppercase tracking-wider opacity-75">{programName}</p>
        <p className="text-2xl font-bold mt-1">
          {stampsCount} <span className="opacity-60 text-base">/ {stampsRequired}</span>
        </p>
      </div>

      <div className="px-5 pb-5">
        <div className="grid grid-cols-5 gap-2">
          {stamps.map((filled, i) => (
            <div
              key={i}
              className={cn(
                "aspect-square rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors",
                filled ? "bg-white text-black border-white" : "border-white/40 bg-transparent",
              )}
              aria-label={`Stamp ${i + 1} ${filled ? "filled" : "empty"}`}
            >
              {filled ? "★" : ""}
            </div>
          ))}
        </div>
      </div>

      <div
        className="px-5 py-3 text-xs flex items-center justify-between"
        style={{ backgroundColor: "rgba(0,0,0,0.18)" }}
      >
        <span className="opacity-70">Reward</span>
        <span className="font-medium truncate max-w-[200px]">{rewardLabel}</span>
      </div>
    </div>
  );
}
