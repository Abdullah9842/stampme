"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireMerchant } from "@/lib/auth/current-merchant";
import {
  updateMerchantSchema,
  setStaffPinSchema,
  type UpdateMerchantInput,
  type SetStaffPinInput,
} from "@/lib/validation/merchant";
import { hashPin } from "@/lib/pin";
import type { ActionResult } from "@/lib/actions/onboarding";
import { authedMerchantLimiter } from "@/lib/ratelimit";

export async function updateMerchantProfile(
  input: UpdateMerchantInput,
): Promise<ActionResult<{ id: string }>> {
  const merchant = await requireMerchant();
  if (!merchant) return { ok: false, error: "Merchant not found" };

  const rl = await authedMerchantLimiter.limit(merchant.id);
  if (!rl.success) {
    return { ok: false, error: "Too many requests, slow down" };
  }

  const parsed = updateMerchantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid update payload",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.vertical !== undefined) data.vertical = parsed.data.vertical;
  if (parsed.data.logoUrl !== undefined) data.logoUrl = parsed.data.logoUrl;
  if (parsed.data.brandColor !== undefined) data.brandColor = parsed.data.brandColor;

  const updated = await db.merchant.update({
    where: { id: merchant.id },
    data,
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, data: { id: updated.id } };
}

export async function setStaffPin(
  input: SetStaffPinInput,
): Promise<ActionResult<{ ok: true }>> {
  const merchant = await requireMerchant();
  if (!merchant) return { ok: false, error: "Merchant not found" };

  const rl = await authedMerchantLimiter.limit(merchant.id);
  if (!rl.success) {
    return { ok: false, error: "Too many requests, slow down" };
  }

  const parsed = setStaffPinSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid PIN",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const pinHash = await hashPin(parsed.data.pin);

  await db.$transaction(async (tx) => {
    await tx.staffPin.deleteMany({ where: { merchantId: merchant.id } });
    await tx.staffPin.create({
      data: {
        merchantId: merchant.id,
        pinHash,
        label: "default",
      },
    });
  });

  revalidatePath("/settings");
  return { ok: true, data: { ok: true } };
}
