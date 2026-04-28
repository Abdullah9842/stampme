import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/marketing/LocaleSwitcher";
import { Link as IntlLink } from "@/lib/i18n/navigation";

function Nav() {
  const t = useTranslations("Marketing.nav");
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-6">
        <Link href="/" className="text-lg font-extrabold tracking-tight">
          stampme
        </Link>
        <nav className="hidden items-center gap-6 text-sm md:flex">
          <Link href="#how-it-works" className="text-muted-foreground hover:text-foreground">
            {t("features")}
          </Link>
          <Link href="#pricing" className="text-muted-foreground hover:text-foreground">
            {t("pricing")}
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <IntlLink href="/sign-in">{t("signIn")}</IntlLink>
          </Button>
          <Button asChild size="sm">
            <IntlLink href="/sign-up">{t("signUp")}</IntlLink>
          </Button>
        </div>
      </div>
    </header>
  );
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
