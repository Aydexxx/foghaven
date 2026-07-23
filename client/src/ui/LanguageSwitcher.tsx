import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, saveLocale, type Locale } from "../i18n/localeSettings";

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  tr: "Türkçe",
};

/**
 * A minimal language picker — `i18n.changeLanguage` re-renders every
 * `useTranslation()` consumer immediately, no reload needed. Persisted the
 * same way every other preference in this app is (see `i18n/localeSettings.ts`).
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <select
      className="language-switcher"
      value={i18n.language}
      onChange={(e) => {
        const locale = e.target.value as Locale;
        void i18n.changeLanguage(locale);
        saveLocale(locale);
      }}
      aria-label={t("app.languageLabel")}
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_LABELS[locale]}
        </option>
      ))}
    </select>
  );
}
