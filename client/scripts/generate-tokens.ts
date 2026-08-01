/**
 * Generates client/src/theme/tokens.css from client/src/theme/tokens.ts.
 *
 * tokens.ts is the single source of truth for design tokens. This script
 * mirrors it into CSS custom properties so the two representations can never
 * drift — never hand-edit tokens.css, run `npm run tokens:build` instead.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  core,
  materials,
  light,
  semantic,
  lanternColors,
  fonts,
  fontStacks,
  fontFaces,
  typeScale,
  spacing,
  radius,
  duration,
  derived,
} from "../src/theme/tokens.ts";

const outPath = fileURLToPath(new URL("../src/theme/tokens.css", import.meta.url));

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function colorLines(group: Record<string, string>): string[] {
  return Object.entries(group).map(([key, hex]) => `  --color-${kebab(key)}: ${hex};`);
}

const lines: string[] = [];

lines.push("/**");
lines.push(" * GENERATED FILE — do not hand-edit.");
lines.push(" * Source of truth: client/src/theme/tokens.ts");
lines.push(" * Regenerate with: npm run tokens:build -w client");
lines.push(" */");

lines.push("/* §7 Typography — self-hosted @font-face declarations. */");
for (const face of fontFaces) {
  for (const subset of face.subsets) {
    const base = `/fonts/${face.dir}/${subset.file}`;
    lines.push("@font-face {");
    lines.push(`  font-family: '${face.family}';`);
    lines.push(`  font-style: ${face.style};`);
    lines.push(`  font-weight: ${face.weight};`);
    lines.push("  font-display: swap;");
    lines.push(`  src: url('${base}.woff2') format('woff2'), url('${base}.woff') format('woff');`);
    lines.push(`  unicode-range: ${subset.unicodeRange};`);
    lines.push("}");
  }
}
lines.push("");

lines.push(":root {");

lines.push("  /* §3.1 Core */");
lines.push(...colorLines(core));
lines.push("  /* §3.2 Materials */");
lines.push(...colorLines(materials));
lines.push("  /* §3.3 Light */");
lines.push(...colorLines(light));
lines.push("  /* §3.4 Semantic */");
lines.push(...colorLines(semantic));

lines.push("  /* §3.5 Player lantern colours, in canonical order */");
lanternColors.forEach((lantern, index) => {
  lines.push(`  --color-lantern-${lantern.id}: ${lantern.hex}; /* ${index + 1} of ${lanternColors.length} */`);
});

lines.push("  /* §7 Typography */");
lines.push(`  --font-family-display: ${fontStacks.display};`);
lines.push(`  --font-weight-display: ${fonts.display.weight};`);
lines.push(`  --font-family-ui: ${fontStacks.ui};`);
lines.push(`  --font-weight-ui-regular: ${fonts.ui.weightRegular};`);
lines.push(`  --font-weight-ui-bold: ${fonts.ui.weightBold};`);
lines.push(`  --font-family-numeric: ${fontStacks.numeric};`);
lines.push(`  --font-weight-numeric: ${fonts.numeric.weight};`);
for (const [key, scale] of Object.entries(typeScale)) {
  const name = kebab(key);
  lines.push(`  --font-size-${name}: ${scale.fontSize}px;`);
  lines.push(`  --line-height-${name}: ${scale.lineHeight};`);
}

lines.push("  /* Spacing scale */");
for (const [key, value] of Object.entries(spacing)) {
  lines.push(`  --space-${kebab(key)}: ${value}px;`);
}

lines.push("  /* Radius scale */");
for (const [key, value] of Object.entries(radius)) {
  lines.push(`  --radius-${kebab(key)}: ${value}px;`);
}

lines.push("  /* Duration scale */");
for (const [key, value] of Object.entries(duration)) {
  lines.push(`  --duration-${kebab(key)}: ${value}ms;`);
}

lines.push("  /* Derived (see tokens.ts `derived` for why these are formulas, not colours) */");
for (const [key, value] of Object.entries(derived)) {
  lines.push(`  --${kebab(key)}: ${value};`);
}

lines.push("}");
lines.push("");

writeFileSync(outPath, lines.join("\n"), "utf-8");
console.log(`Wrote ${outPath}`);
