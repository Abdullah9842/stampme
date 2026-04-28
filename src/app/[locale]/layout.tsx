import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { ClerkProvider } from "@clerk/nextjs";
import { arSA, enUS } from "@clerk/localizations";
import { routing, type Locale } from "@/lib/i18n/routing";

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "stampme", template: "%s · stampme" },
  description: "Digital loyalty stamp cards for KSA merchants — Apple Wallet + Google Wallet.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const messages = await getMessages();
  const dir = (locale as Locale) === "ar" ? "rtl" : "ltr";
  const clerkLocalization = (locale as Locale) === "ar" ? arSA : enUS;

  return (
    <ClerkProvider localization={clerkLocalization}>
      <html lang={locale} dir={dir} className={tajawal.variable} suppressHydrationWarning>
        <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
