"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SlugCard({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/c/${slug}` : `/c/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6 space-y-3">
      <h2 className="text-lg font-semibold">Enrollment URL</h2>
      <p className="text-sm text-muted-foreground">
        Share this link or the QR code (Plan 4) to let customers add your card to their wallet.
      </p>
      <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 font-mono text-sm">
        <span className="truncate flex-1">{url}</span>
        <Button type="button" size="sm" variant="ghost" onClick={copy} aria-label="Copy URL">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </section>
  );
}
