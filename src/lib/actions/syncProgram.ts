"use server";

import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createProgram, updateProgramTemplate } from "@/lib/passkit/programs";
import { PassKitError, PassKitErrorCode } from "@/lib/passkit/types";

const Input = z.object({ loyaltyProgramId: z.string().min(1) });
type Input = z.infer<typeof Input>;

export interface SyncProgramResult {
  passKitProgramId: string;
  created: boolean;
}

export async function syncProgram(input: Input): Promise<SyncProgramResult> {
  const { loyaltyProgramId } = Input.parse(input);

  const program = await db.loyaltyProgram.findUnique({
    where: { id: loyaltyProgramId },
    include: { merchant: true },
  });
  if (!program) {
    throw new PassKitError({
      code: PassKitErrorCode.NOT_FOUND,
      message: `LoyaltyProgram ${loyaltyProgramId} not found`,
    });
  }

  const session = await auth();
  if (session?.userId && session.userId !== program.merchant.clerkUserId) {
    throw new PassKitError({
      code: PassKitErrorCode.AUTH,
      message: "not authorised to sync this program",
    });
  }

  if (!program.merchant.logoUrl) {
    throw new Error("merchant logo is required before syncing to wallet");
  }

  const designPayload = {
    name: program.name,
    brandColor: program.merchant.brandColor,
    logoUrl: program.merchant.logoUrl,
    rewardLabel: program.rewardLabel,
    stampsRequired: program.stampsRequired,
  };

  let created = false;
  let passKitProgramId = program.passKitProgramId;

  try {
    if (!passKitProgramId) {
      const out = await createProgram({
        merchantId: program.merchantId,
        ...designPayload,
      });
      passKitProgramId = out.passKitProgramId;
      await db.loyaltyProgram.update({
        where: { id: loyaltyProgramId },
        data: { passKitProgramId },
      });
      created = true;
    }

    await updateProgramTemplate({
      programId: passKitProgramId,
      ...designPayload,
    });

    return { passKitProgramId, created };
  } catch (e) {
    Sentry.captureException(e, {
      tags: { stage: "syncProgram", merchantId: program.merchantId, loyaltyProgramId },
    });
    throw e;
  }
}
