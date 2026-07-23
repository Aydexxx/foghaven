/**
 * Persistence for the chosen UI language. Same localStorage-with-try/catch
 * shape as `graphics/settings.ts`/`audio/settings.ts`/`input/settings.ts`.
 */

export const SUPPORTED_LOCALES = ["en", "tr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = "foghaven.locale";
const DEFAULT_LOCALE: Locale = "en";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode, quota, disabled) — losing
    // the saved preference just means defaulting to English next time.
  }
}
