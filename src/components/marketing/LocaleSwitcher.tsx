"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";

export function LocaleSwitcher() {
  const t = useTranslations("Marketing.localeSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div className="flex items-center gap-2 text-sm" aria-label={t("label")}>
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchTo(l)}
          disabled={pending || l === locale}
          className={
            l === locale
              ? "font-semibold text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }
        >
          {t(l)}
        </button>
      ))}
    </div>
  );
}
