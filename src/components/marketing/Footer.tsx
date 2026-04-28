import { useTranslations } from "next-intl";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/lib/i18n/navigation";

export function Footer() {
  const t = useTranslations("Marketing.footer");
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-muted/30">
      <div className="container mx-auto px-6 py-12">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <div className="text-lg font-bold">stampme</div>
            <p className="mt-1 text-sm text-muted-foreground">{t("tagline")}</p>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
              {t("privacy")}
            </Link>
            <Link href="/terms" className="text-muted-foreground hover:text-foreground">
              {t("terms")}
            </Link>
          </nav>
        </div>
        <Separator className="my-6" />
        <p className="text-xs text-muted-foreground">
          © {year} stampme · {t("rights")}
        </p>
      </div>
    </footer>
  );
}
