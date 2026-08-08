import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { LANGS, setLanguage, type Lang } from "@/i18n";

/** 한국어 / English 전환 버튼. */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "ko") as Lang;
  const next = LANGS.find((l) => l !== current) ?? current;

  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      aria-label={t("language.label")}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
    >
      <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="uppercase tracking-wide">{current}</span>
    </button>
  );
}

