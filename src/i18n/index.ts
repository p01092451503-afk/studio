import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

// Korean-first bilingual platform. The choice is remembered per browser.
export const LANGS = ["ko", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const STORAGE_KEY = "app-lang";

function initialLang(): Lang {
  if (typeof window === "undefined") return "ko";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "en" || saved === "ko" ? saved : "ko";
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ko: { translation: ko },
    },
    lng: initialLang(),
    fallbackLng: "ko",
    supportedLngs: LANGS as unknown as string[],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export function setLanguage(lang: Lang) {
  void i18n.changeLanguage(lang);
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, lang);
}

export default i18n;
