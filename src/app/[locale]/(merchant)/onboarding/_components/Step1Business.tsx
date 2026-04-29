"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VERTICALS, type Vertical } from "@/lib/validation/merchant";

const LABELS: Record<Vertical, string> = {
  CAFE: "Cafe / Coffee",
  SALON: "Salon / Barber",
  JUICE: "Juice bar",
  BAKERY: "Bakery / Sweets",
  LAUNDRY: "Laundry",
  OTHER: "Other",
};

type Props = {
  value: { name: string; vertical: Vertical };
  onChange: (v: { name?: string; vertical?: Vertical }) => void;
};

export function Step1Business({ value, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Tell us about your business</h2>
        <p className="text-sm text-muted-foreground">This appears on your loyalty card.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="biz-name">Business name</Label>
        <Input
          id="biz-name"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Mocha Bros"
          maxLength={80}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="biz-vertical">Vertical</Label>
        <Select
          value={value.vertical}
          onValueChange={(v) => onChange({ vertical: v as Vertical })}
        >
          <SelectTrigger id="biz-vertical">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERTICALS.map((v) => (
              <SelectItem key={v} value={v}>
                {LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
