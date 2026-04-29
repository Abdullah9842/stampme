"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Props = {
  value?: string | null; // existing URL
  onFileSelected: (file: File) => void | Promise<void>;
  onCleared?: () => void;
  accept?: string;
  maxBytes?: number;
  busy?: boolean;
  className?: string;
};

export function FileDropzone({
  value,
  onFileSelected,
  onCleared,
  accept = "image/png,image/svg+xml,image/jpeg,image/webp",
  maxBytes = 2 * 1024 * 1024,
  busy = false,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (f: File) => {
      setError(null);
      if (f.size > maxBytes) {
        setError(`File too large. Max ${(maxBytes / 1024 / 1024).toFixed(1)}MB.`);
        return;
      }
      void onFileSelected(f);
    },
    [maxBytes, onFileSelected],
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 cursor-pointer transition-colors",
          hover && "bg-muted border-primary",
          busy && "opacity-60 pointer-events-none",
        )}
        aria-label="Upload logo"
      >
        {value ? (
          <div className="relative h-24 w-24">
            <Image
              src={value}
              alt="Logo preview"
              fill
              sizes="96px"
              className="object-contain"
              unoptimized={value.endsWith(".svg")}
            />
          </div>
        ) : (
          <>
            <UploadCloud className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Drop logo here or click to upload</p>
            <p className="text-xs text-muted-foreground">PNG, SVG, JPG or WEBP — max 2MB</p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {value && onCleared && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCleared}
          className="text-muted-foreground"
        >
          <X className="h-4 w-4 mr-1" aria-hidden />
          Remove
        </Button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
