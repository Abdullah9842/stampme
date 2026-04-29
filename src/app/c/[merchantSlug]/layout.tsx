import "@/app/globals.css";
import { Tajawal } from "next/font/google";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { merchantSlugSchema } from "@/lib/validation/enrollment";

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
  display: "swap",
});

export const dynamic = "force-dynamic";

export default async function MerchantPublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ merchantSlug: string }>;
}) {
  const { merchantSlug } = await params;
  const slug = merchantSlugSchema.safeParse(merchantSlug);
  if (!slug.success) notFound();

  const merchant = await db.merchant.findUnique({
    where: { slug: slug.data },
    select: { id: true, name: true, logoUrl: true, brandColor: true },
  });
  if (!merchant) notFound();

  return (
    <html
      lang="ar"
      dir="rtl"
      className={tajawal.variable}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-white font-sans text-neutral-900 antialiased">
        <div
          style={{ ["--brand" as string]: merchant.brandColor }}
          className="min-h-screen"
        >
          {children}
          <footer className="py-6 text-center text-xs text-neutral-400">
            Powered by <span className="font-medium">stampme</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
