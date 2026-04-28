import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/i18n/navigation";

export function Hero() {
  const t = useTranslations("Marketing.hero");
  return (
    <section className="container mx-auto px-6 py-20 md:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="secondary" className="mb-6">
          {t("badge")}
        </Badge>
        <h1 className="text-balance text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
          {t("title")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground md:text-xl">
          {t("subtitle")}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/sign-up">{t("ctaPrimary")}</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
            <Link href="#how-it-works">{t("ctaSecondary")}</Link>
          </Button>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">{t("trust")}</p>
      </div>
    </section>
  );
}
