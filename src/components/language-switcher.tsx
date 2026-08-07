import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { LANGS, setLanguage, type Lang } from "@/i18n";

/** 한국어 / English 전환 토글. */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "ko") as Lang;

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-border bg-card p-1"
      role="radiogroup"
      aria-label={t("language.label")}
    >
      <Languages className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          role="radio"
          aria-checked={current === lang}
          onClick={() => setLanguage(lang)}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
            current === lang
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t(`language.${lang}`)}
        </button>
      ))}
    </div>
  );
}
