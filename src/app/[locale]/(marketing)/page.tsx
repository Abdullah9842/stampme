import { setRequestLocale } from "next-intl/server";

export default async function MarketingHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="container mx-auto p-12">
      <h1 className="text-4xl font-bold">stampme</h1>
      <p className="mt-4 text-muted-foreground">Locale: {locale}</p>
    </main>
  );
}
