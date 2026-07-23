import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/common.json";
import tr from "./locales/tr/common.json";
import { loadLocale } from "./localeSettings";

export const defaultLocale = "en";

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    // Turkish covers all UI copy; the two long-form legal-prose keys
    // (legal.privacy.body / legal.terms.body) are deliberately absent from
    // locales/tr/common.json rather than machine-translated — i18next's
    // fallbackLng below serves the English legal text for those two keys
    // until a professional translation review is done, rather than
    // presenting an unreviewed translation as an official legal document.
    tr: { common: tr },
  },
  lng: loadLocale(),
  fallbackLng: defaultLocale,
  ns: ["common"],
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
