"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { setStaffPin } from "@/lib/actions/settings";

type Props = { hasExistingPin: boolean };

export function StaffPinForm({ hasExistingPin }: Props) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const r = await setStaffPin({ pin, confirmPin });
      if (r.ok) {
        setMsg({ kind: "ok", text: "PIN saved" });
        setPin("");
        setConfirmPin("");
      } else {
        setMsg({ kind: "err", text: r.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {hasExistingPin && (
        <p className="text-xs text-muted-foreground">
          A PIN is already set. Submitting a new one will replace it immediately.
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="pin">New PIN</Label>
          <Input
            id="pin"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm PIN</Label>
          <Input
            id="confirm"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
      </div>

      {msg && (
        <p
          role="status"
          className={msg.kind === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"}
        >
          {msg.text}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving..." : hasExistingPin ? "Reset PIN" : "Set PIN"}
        </Button>
      </div>
    </form>
  );
}
