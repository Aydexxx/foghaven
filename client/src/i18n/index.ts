import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/common.json";

export const defaultLocale = "en";

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
  },
  lng: defaultLocale,
  fallbackLng: defaultLocale,
  ns: ["common"],
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
