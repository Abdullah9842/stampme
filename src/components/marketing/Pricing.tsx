import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { Link } from "@/lib/i18n/navigation";

export function Pricing() {
  const t = useTranslations("Marketing.pricing");
  const features = t.raw("plan.features") as string[];

  return (
    <section id="pricing" className="container mx-auto px-6 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("title")}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="mx-auto max-w-md">
        <Card className="border-2 border-primary/40 shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">{t("plan.name")}</CardTitle>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-extrabold tracking-tight">{t("plan.price")}</span>
              <span className="text-lg text-muted-foreground">{t("plan.currency")}</span>
              <span className="text-sm text-muted-foreground">/ {t("plan.period")}</span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button asChild size="lg" className="mt-8 w-full">
              <Link href="/sign-up">{t("plan.cta")}</Link>
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">{t("vat")}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
