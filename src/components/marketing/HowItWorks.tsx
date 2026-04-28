import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Palette, QrCode, Stamp } from "lucide-react";

const steps = [
  { id: "design", icon: Palette },
  { id: "share", icon: QrCode },
  { id: "redeem", icon: Stamp },
] as const;

export function HowItWorks() {
  const t = useTranslations("Marketing.howItWorks");
  return (
    <section id="how-it-works" className="container mx-auto px-6 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("title")}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {steps.map(({ id, icon: Icon }, i) => (
          <Card key={id} className="border-2">
            <CardContent className="p-6">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-6 w-6" aria-hidden />
              </div>
              <div className="mb-2 text-sm font-semibold text-primary">
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="mb-2 text-xl font-semibold">{t(`steps.${id}.title`)}</h3>
              <p className="text-muted-foreground">{t(`steps.${id}.body`)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
