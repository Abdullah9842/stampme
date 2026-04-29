"use client";

import { useState } from "react";
import { ColorPicker } from "@/components/merchant/ColorPicker";
import { FileDropzone } from "@/components/merchant/FileDropzone";
import { uploadLogo } from "@/lib/actions/upload";

type Props = {
  value: { logoUrl?: string; brandColor: string };
  onChange: (v: { logoUrl?: string; brandColor?: string }) => void;
};

export function Step2Branding({ value, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const result = await uploadLogo(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange({ logoUrl: result.url });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Make it yours</h2>
        <p className="text-sm text-muted-foreground">
          Upload your logo and pick the color that represents your brand.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Logo</p>
        <FileDropzone
          value={value.logoUrl ?? null}
          onFileSelected={handleFile}
          onCleared={() => onChange({ logoUrl: undefined })}
          busy={busy}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <ColorPicker
        value={value.brandColor}
        onChange={(c) => onChange({ brandColor: c })}
      />
    </div>
  );
}
