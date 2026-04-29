"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/merchant/ColorPicker";
import { FileDropzone } from "@/components/merchant/FileDropzone";
import { updateMerchantProfile } from "@/lib/actions/settings";
import { uploadLogo } from "@/lib/actions/upload";
import type { Vertical } from "@/lib/validation/merchant";

type Props = {
  merchant: {
    id: string;
    name: string;
    vertical: Vertical;
    logoUrl: string | null;
    brandColor: string;
  };
};

export function ProfileForm({ merchant }: Props) {
  const [name, setName] = useState(merchant.name);
  const [logoUrl, setLogoUrl] = useState<string | null>(merchant.logoUrl);
  const [brandColor, setBrandColor] = useState(merchant.brandColor);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onFile(f: File) {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const result = await uploadLogo(fd);
      if (!result.ok) {
        setMsg({ kind: "err", text: result.error });
        return;
      }
      setLogoUrl(result.url);
    } finally {
      setBusy(false);
    }
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await updateMerchantProfile({
        name,
        logoUrl: logoUrl ?? undefined,
        brandColor,
      });
      setMsg(
        r.ok
          ? { kind: "ok", text: "Saved" }
          : { kind: "err", text: r.error },
      );
    });
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="s-name">Business name</Label>
        <Input
          id="s-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Logo</Label>
        <FileDropzone
          value={logoUrl}
          onFileSelected={onFile}
          onCleared={() => setLogoUrl(null)}
          busy={busy}
        />
      </div>

      <ColorPicker value={brandColor} onChange={setBrandColor} />

      {msg && (
        <p
          role="status"
          className={msg.kind === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"}
        >
          {msg.text}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || busy}>
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
