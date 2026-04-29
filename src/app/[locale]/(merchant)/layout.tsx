import { auth } from "@clerk/nextjs/server";
import { redirect } from "@/lib/i18n/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";

export default async function MerchantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) {
    const locale = await getLocale();
    redirect({ href: "/sign-in", locale });
  }

  const merchant = await db.merchant.findUnique({
    where: { clerkUserId: userId! },
    select: { id: true, slug: true },
  });

  // Determine current path so we don't loop on /onboarding itself
  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  const isOnboardingRoute = path.endsWith("/onboarding");

  if (!merchant && !isOnboardingRoute) {
    const locale = await getLocale();
    redirect({ href: "/onboarding", locale });
  }

  return (
    <div className="min-h-dvh bg-background">
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
