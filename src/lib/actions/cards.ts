"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { requireMerchant } from "@/lib/auth/current-merchant";
import {
  createCardSchema,
  updateCardSchema,
  type CreateCardInput,
  type UpdateCardInput,
} from "@/lib/validation/card";
import type { ActionResult } from "@/lib/actions/onboarding";
import { syncProgram } from "./syncProgram";

export async function createCard(
  input: CreateCardInput,
): Promise<ActionResult<{ id: string }>> {
  const merchant = await requireMerchant();
  if (!merchant) return { ok: false, error: "Merchant not found" };

  const parsed = createCardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid card payload",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const program = await db.loyaltyProgram.create({
    data: {
      merchantId: merchant.id,
      name: parsed.data.programName,
      stampsRequired: parsed.data.stampsRequired,
      rewardLabel: parsed.data.rewardLabel,
      passKitProgramId: null,
    },
  });

  // Run syncProgram AFTER the response is sent — Vercel's `after()` keeps the
  // function alive long enough for the gRPC roundtrip (~1-3s) without blocking
  // the user. Plain fire-and-forget gets killed when the lambda freezes after
  // returning the response.
  after(async () => {
    try {
      await syncProgram({ loyaltyProgramId: program.id });
    } catch (e) {
      Sentry.captureException(e, { tags: { stage: "card-create-sync" } });
    }
  });

  revalidatePath("/cards");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: program.id } };
}

export async function updateCard(
  input: UpdateCardInput,
): Promise<ActionResult<{ id: string }>> {
  const merchant = await requireMerchant();
  if (!merchant) return { ok: false, error: "Merchant not found" };

  const parsed = updateCardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid card payload",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const owned = await db.loyaltyProgram.findFirst({
    where: { id: parsed.data.id, merchantId: merchant.id },
    select: { id: true, merchantId: true },
  });
  if (!owned) return { ok: false, error: "Card not found" };

  const { id, ...rest } = parsed.data;
  const data: Record<string, unknown> = {};
  if (rest.programName !== undefined) data.name = rest.programName;
  if (rest.stampsRequired !== undefined) data.stampsRequired = rest.stampsRequired;
  if (rest.rewardLabel !== undefined) data.rewardLabel = rest.rewardLabel;

  const updated = await db.loyaltyProgram.update({
    where: { id },
    data,
  });

  revalidatePath(`/cards/${id}/edit`);
  revalidatePath("/cards");
  return { ok: true, data: { id: updated.id } };
}

export async function listCards(): Promise<
  ActionResult<
    Array<{
      id: string;
      name: string;
      stampsRequired: number;
      rewardLabel: string;
      passKitProgramId: string | null;
      createdAt: Date;
    }>
  >
> {
  const merchant = await requireMerchant();
  if (!merchant) return { ok: false, error: "Merchant not found" };

  const programs = await db.loyaltyProgram.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
  });
  return {
    ok: true,
    data: programs.map((p) => ({
      id: p.id,
      name: p.name,
      stampsRequired: p.stampsRequired,
      rewardLabel: p.rewardLabel,
      passKitProgramId: p.passKitProgramId,
      createdAt: p.createdAt,
    })),
  };
}
