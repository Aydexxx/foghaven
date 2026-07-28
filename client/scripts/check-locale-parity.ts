/**
 * CI gate: every key that is present and non-empty in the reference locale
 * (en) must also be present and non-empty in every other locale. Reports
 * every offending key across every locale/namespace in one run — not just
 * the first — so a translator can fix everything in one pass.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REFERENCE = "en";
const localesDir = fileURLToPath(new URL("../src/i18n/locales", import.meta.url));

/**
 * Known, tracked exceptions — "locale/namespace:key" — for content that is
 * intentionally not yet translated and should NOT block CI. Keep this list
 * as small and short-lived as possible; every entry needs a reason and an
 * owner path forward, not just a shrug.
 *
 * tr/legal.privacy.body and tr/legal.terms.body: the Privacy Policy and
 * Terms of Service body text is a legally operative document, not ordinary
 * UI copy — it needs a real (reviewed, ideally professional) Turkish
 * translation, not a mechanical/AI one. Tracked here instead of silently
 * left broken so the gap stays visible without failing every build for a
 * known, already-flagged issue. Remove once translated.
 */
const KNOWN_EXCEPTIONS = new Set<string>([
  "tr/common.json:legal.privacy.body",
  "tr/common.json:legal.terms.body",
]);

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | JsonObject;

function flatten(obj: JsonObject, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.set(keyPath, value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flatten(value, keyPath)) out.set(k, v);
    } else {
      throw new Error(`Unexpected non-string, non-object value at "${keyPath}" (type ${typeof value})`);
    }
  }
  return out;
}

const locales = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (!locales.includes(REFERENCE)) {
  console.error(`Reference locale "${REFERENCE}" not found under ${localesDir}`);
  process.exit(1);
}

const otherLocales = locales.filter((locale) => locale !== REFERENCE);
const referenceDir = path.join(localesDir, REFERENCE);
const namespaceFiles = readdirSync(referenceDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

interface Offense {
  locale: string;
  namespace: string;
  key: string;
  reason: "missing" | "empty";
}

const offenses: Offense[] = [];

for (const namespace of namespaceFiles) {
  const referenceFlat = flatten(JSON.parse(readFileSync(path.join(referenceDir, namespace), "utf-8")) as JsonObject);

  for (const locale of otherLocales) {
    const localePath = path.join(localesDir, locale, namespace);
    const localeFlat = existsSync(localePath)
      ? flatten(JSON.parse(readFileSync(localePath, "utf-8")) as JsonObject)
      : new Map<string, string>();

    if (!existsSync(localePath)) {
      offenses.push({ locale, namespace, key: "*", reason: "missing" });
      continue;
    }

    for (const [key, referenceValue] of referenceFlat) {
      if (referenceValue.trim() === "") continue; // en itself is empty/placeholder here — not this check's concern
      const localeValue = localeFlat.get(key);
      if (localeValue === undefined) {
        offenses.push({ locale, namespace, key, reason: "missing" });
      } else if (localeValue.trim() === "") {
        offenses.push({ locale, namespace, key, reason: "empty" });
      }
    }
  }
}

const blocking = offenses.filter((o) => !KNOWN_EXCEPTIONS.has(`${o.locale}/${o.namespace}:${o.key}`));
const excepted = offenses.filter((o) => KNOWN_EXCEPTIONS.has(`${o.locale}/${o.namespace}:${o.key}`));

function printOffenses(list: Offense[]): void {
  const byLocale = new Map<string, Offense[]>();
  for (const offense of list) {
    if (!byLocale.has(offense.locale)) byLocale.set(offense.locale, []);
    byLocale.get(offense.locale)!.push(offense);
  }
  for (const [locale, entries] of byLocale) {
    console.error(`  ${locale}/ — ${entries.length} offender(s):`);
    for (const offense of entries) {
      console.error(`    [${offense.reason}] ${offense.namespace}: ${offense.key}`);
    }
  }
}

if (excepted.length > 0) {
  console.warn(`${excepted.length} known, tracked exception(s) (see KNOWN_EXCEPTIONS) — not failing the build:`);
  printOffenses(excepted);
  console.warn("");
}

if (blocking.length > 0) {
  console.error(
    `Locale parity check failed: ${blocking.length} key(s) present and non-empty in "${REFERENCE}" but missing or empty elsewhere.\n`,
  );
  printOffenses(blocking);
  process.exit(1);
}

console.log(
  `Locale parity OK — ${otherLocales.length} locale(s) checked against "${REFERENCE}" across ${namespaceFiles.length} namespace file(s)` +
    (excepted.length > 0 ? ` (${excepted.length} tracked exception(s) — see above).` : "."),
);
