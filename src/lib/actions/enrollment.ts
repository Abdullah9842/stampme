"use server";

import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { issuePass } from "@/lib/passkit/passes";
import {
  enrollIpLimiter,
  enrollPhoneLimiter,
  recoverPhoneLimiter,
} from "@/lib/ratelimit";
import { verifyEnrollmentSignature } from "@/lib/hmac";
import {
  enrollPayloadSchema,
  recoverPayloadSchema,
} from "@/lib/validation/enrollment";

type EnrollSuccess = {
  ok: true;
  passId: string;
  applePassUrl: string;
  googleWalletUrl: string;
  alreadyEnrolled: boolean;
};

type EnrollFailure = {
  ok: false;
  code:
    | "VALIDATION"
    | "RATE_LIMITED"
    | "MERCHANT_NOT_FOUND"
    | "PROGRAM_NOT_READY"
    | "INVALID_SIGNATURE"
    | "INTERNAL";
  message: string;
  resetAt?: number;
};

export type EnrollResult = EnrollSuccess | EnrollFailure;

async function getClientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "0.0.0.0"
  );
}

export async function enrollCustomer(input: unknown): Promise<EnrollResult> {
  const parsed = enrollPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { merchantSlug, phone, sig, exp } = parsed.data;

  if (sig && exp) {
    if (!verifyEnrollmentSignature(merchantSlug, exp, sig)) {
      return { ok: false, code: "INVALID_SIGNATURE", message: "Invalid or expired link" };
    }
  }

  const ip = await getClientIp();
  const ipRes = await enrollIpLimiter.limit(ip);
  if (!ipRes.success) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many requests", resetAt: ipRes.reset };
  }
  const phoneRes = await enrollPhoneLimiter.limit(phone);
  if (!phoneRes.success) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many requests", resetAt: phoneRes.reset };
  }

  try {
    const merchant = await db.merchant.findUnique({ where: { slug: merchantSlug } });
    if (!merchant) return { ok: false, code: "MERCHANT_NOT_FOUND", message: "Unknown merchant" };

    const program = await db.loyaltyProgram.findFirst({
      where: { merchantId: merchant.id, passKitProgramId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (!program?.passKitProgramId) {
      return { ok: false, code: "PROGRAM_NOT_READY", message: "Loyalty program not ready" };
    }

    const existing = await db.pass.findFirst({
      where: { programId: program.id, customerPhone: phone, status: { not: "DELETED" } },
    });
    if (existing && existing.applePassUrl && existing.googleWalletUrl) {
      return {
        ok: true,
        passId: existing.id,
        applePassUrl: existing.applePassUrl,
        googleWalletUrl: existing.googleWalletUrl,
        alreadyEnrolled: true,
      };
    }

    const issued = await issuePass({
      programId: program.passKitProgramId,
      customerPhone: phone,
    });

    const created = await db.pass.create({
      data: {
        programId: program.id,
        customerPhone: phone,
        passKitPassId: issued.passKitPassId,
        applePassUrl: issued.applePassUrl,
        googleWalletUrl: issued.googleWalletUrl,
        status: "ACTIVE",
        stampsCount: 0,
      },
    });

    return {
      ok: true,
      passId: created.id,
      applePassUrl: issued.applePassUrl,
      googleWalletUrl: issued.googleWalletUrl,
      alreadyEnrolled: false,
    };
  } catch (err) {
    Sentry.captureException(err, { tags: { action: "enrollCustomer", merchantSlug } });
    return { ok: false, code: "INTERNAL", message: "Something went wrong" };
  }
}

type RecoverResult =
  | { ok: true; applePassUrl: string; googleWalletUrl: string }
  | { ok: false; code: "VALIDATION" | "RATE_LIMITED" | "NOT_FOUND" | "INTERNAL"; message: string; resetAt?: number };

export async function recoverPass(input: unknown): Promise<RecoverResult> {
  const parsed = recoverPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const { merchantSlug, phone } = parsed.data;

  const phoneRes = await recoverPhoneLimiter.limit(phone);
  if (!phoneRes.success) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many attempts", resetAt: phoneRes.reset };
  }

  try {
    const merchant = await db.merchant.findUnique({ where: { slug: merchantSlug } });
    if (!merchant) return { ok: false, code: "NOT_FOUND", message: "Not found" };

    const program = await db.loyaltyProgram.findFirst({
      where: { merchantId: merchant.id, passKitProgramId: { not: null } },
    });
    if (!program) return { ok: false, code: "NOT_FOUND", message: "Not found" };

    const existing = await db.pass.findFirst({
      where: { programId: program.id, customerPhone: phone, status: { not: "DELETED" } },
    });
    if (!existing) return { ok: false, code: "NOT_FOUND", message: "No pass found for this phone" };
    if (!existing.applePassUrl || !existing.googleWalletUrl) {
      return { ok: false, code: "NOT_FOUND", message: "Pass URLs missing — please re-enroll" };
    }

    return {
      ok: true,
      applePassUrl: existing.applePassUrl,
      googleWalletUrl: existing.googleWalletUrl,
    };
  } catch (err) {
    Sentry.captureException(err, { tags: { action: "recoverPass", merchantSlug } });
    return { ok: false, code: "INTERNAL", message: "Something went wrong" };
  }
}
