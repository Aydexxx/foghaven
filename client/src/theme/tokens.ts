/**
 * Design tokens for Foghaven, mirroring docs/ART_BIBLE.md §3 (Palette) and §7
 * (Typography), plus spacing/radius/duration scales.
 *
 * This is the single source of truth. `tokens.css` is generated from this
 * file by `scripts/generate-tokens.ts` — never hand-edit tokens.css.
 */

export { lanternColors, type LanternColor, type LanternColorId } from "@foghaven/shared";

// ---------------------------------------------------------------------------
// §3.1 Core
// ---------------------------------------------------------------------------

export const core = {
  ink: "#1A1620",
  void: "#241F2E",
  fogDark: "#2E3A47",
  fogMid: "#3F5060",
  fogLight: "#5C7285",
  mist: "#8FA3B0",
  foam: "#C3D2D8",
} as const;

// ---------------------------------------------------------------------------
// §3.2 Materials
// ---------------------------------------------------------------------------

export const materials = {
  woodDark: "#3B2A22",
  woodMid: "#6B4A34",
  woodLight: "#9A7050",
  stoneDark: "#3A3A42",
  stoneMid: "#4A4A52",
  ropeTan: "#B49A72",
  ironCold: "#5A6470",
} as const;

// ---------------------------------------------------------------------------
// §3.3 Light (the game's only warm family)
// ---------------------------------------------------------------------------

export const light = {
  flameCore: "#FFF3C4",
  flameGlow: "#FFC65C",
  flameDeep: "#E08A2E",
} as const;

// ---------------------------------------------------------------------------
// §3.4 Semantic
// ---------------------------------------------------------------------------

export const semantic = {
  townGreen: "#6FB08A",
  strangerRed: "#C24A4A",
  bloodDeep: "#8E1B24",
  bloodBright: "#E5453F",
  voteGold: "#E8B94A",
} as const;

export const colors = { ...core, ...materials, ...light, ...semantic } as const;

// ---------------------------------------------------------------------------
// §7 Typography
// ---------------------------------------------------------------------------

export const fonts = {
  display: { name: "Alfa Slab One", fallback: "serif", weight: 400 },
  ui: { name: "Nunito", fallback: "sans-serif", weightRegular: 700, weightBold: 800 },
  numeric: { name: "JetBrains Mono", fallback: "monospace", weight: 700 },
} as const;

function fontStack(name: string, fallback: string): string {
  return `'${name}', ${fallback}`;
}

// The exact CSS font-family value for each role — computed once from `fonts`
// so the CSS custom properties (index.css/tokens.css) and Phaser canvas text
// (theme/phaserText.ts) request the literal same string. Neither layer may
// build its own font-family string from `fonts.*.name` independently — that
// is exactly how the two would drift.
export const fontStacks = {
  display: fontStack(fonts.display.name, fonts.display.fallback),
  ui: fontStack(fonts.ui.name, fonts.ui.fallback),
  numeric: fontStack(fonts.numeric.name, fonts.numeric.fallback),
} as const;

// Self-hosted under client/public/fonts/ (see docs/ART_BIBLE.md §7 — "do not
// hotlink Google Fonts"). Each family is subset into "latin" and
// "latin-ext" — both are required: Turkish characters (ğ Ğ ü Ü ş Ş ı İ ö Ö ç
// Ç) split across the two (ü/Ü/ö/Ö/ç/Ç/ı are in "latin"; ğ/Ğ/İ/ş/Ş are in
// "latin-ext"). unicode-range values are the standard google-fonts subset
// ranges (verified against the actual glyph tables at build time, not just
// asserted) and are identical across all three families.
const UNICODE_RANGE = {
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  latinExt:
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
} as const;

interface FontFaceSubset {
  unicodeRange: string;
  /** Basename under client/public/fonts/<dir>/, without extension. */
  file: string;
}

interface FontFaceDef {
  family: string;
  dir: string;
  weight: number;
  style: "normal";
  subsets: readonly [FontFaceSubset, FontFaceSubset];
}

export const fontFaces: readonly FontFaceDef[] = [
  {
    family: fonts.display.name,
    dir: "alfa-slab-one",
    weight: fonts.display.weight,
    style: "normal",
    subsets: [
      { unicodeRange: UNICODE_RANGE.latin, file: "alfa-slab-one-400-latin" },
      { unicodeRange: UNICODE_RANGE.latinExt, file: "alfa-slab-one-400-latin-ext" },
    ],
  },
  {
    family: fonts.ui.name,
    dir: "nunito",
    weight: fonts.ui.weightRegular,
    style: "normal",
    subsets: [
      { unicodeRange: UNICODE_RANGE.latin, file: "nunito-700-latin" },
      { unicodeRange: UNICODE_RANGE.latinExt, file: "nunito-700-latin-ext" },
    ],
  },
  {
    family: fonts.ui.name,
    dir: "nunito",
    weight: fonts.ui.weightBold,
    style: "normal",
    subsets: [
      { unicodeRange: UNICODE_RANGE.latin, file: "nunito-800-latin" },
      { unicodeRange: UNICODE_RANGE.latinExt, file: "nunito-800-latin-ext" },
    ],
  },
  {
    family: fonts.numeric.name,
    dir: "jetbrains-mono",
    weight: fonts.numeric.weight,
    style: "normal",
    subsets: [
      { unicodeRange: UNICODE_RANGE.latin, file: "jetbrains-mono-700-latin" },
      { unicodeRange: UNICODE_RANGE.latinExt, file: "jetbrains-mono-700-latin-ext" },
    ],
  },
] as const;

export const typeScale = {
  displayXl: { fontSize: 44, lineHeight: 1.1 },
  displayLg: { fontSize: 32, lineHeight: 1.15 },
  title: { fontSize: 24, lineHeight: 1.2 },
  body: { fontSize: 18, lineHeight: 1.4 },
  label: { fontSize: 15, lineHeight: 1.3 },
  caption: { fontSize: 13, lineHeight: 1.3 },
} as const;

// ---------------------------------------------------------------------------
// Spacing scale (px)
// ---------------------------------------------------------------------------

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// ---------------------------------------------------------------------------
// Radius scale (px)
// ---------------------------------------------------------------------------

export const radius = {
  sm: 6,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 20,
} as const;

// ---------------------------------------------------------------------------
// Duration scale (ms)
// ---------------------------------------------------------------------------

export const duration = {
  fast: 60,
  base: 120,
  slow: 300,
  scene: 1200,
  /**
   * ART_BIBLE §9: "Task progress bar advances | Never jumps. Always tweens
   * over 400 ms." A token of its own rather than reusing `slow` because §9
   * names this number specifically, and because the CSS transition and
   * `juiceEvents.TASK_PROGRESS_TWEEN_MS` have to be the same value — a bar
   * whose transition outlasts the effect driving it visibly stutters.
   */
  taskProgress: 400,
} as const;

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

/**
 * Alpha overlays and washes computed from §3 colours via `color-mix()`,
 * rather than new hex literals. Each is a formula, not a palette entry — §5
 * ("Palette lock") governs *colours*, not opacity, so these don't need a §3
 * addition, but the formula itself is worth naming once here instead of
 * being re-derived (or silently drifting) wherever a panel needs a drop
 * shadow. `generate-tokens.ts` mirrors these into `--shadow-deep`,
 * `--shadow-soft`, `--highlight`, and `--danger-well` in `tokens.css`.
 */
export const derived = {
  /** Panel/card drop shadow, resting depth. */
  shadowDeep: "color-mix(in srgb, var(--color-ink) 55%, transparent)",
  /** Panel/card drop shadow, subtle depth (inputs, inline chrome). */
  shadowSoft: "color-mix(in srgb, var(--color-ink) 30%, transparent)",
  /** ART_BIBLE §8 Panel: "Inner top highlight: 2px fogLight at 15% alpha". */
  highlight: "color-mix(in srgb, var(--color-fog-light) 15%, transparent)",
  /** Low-alpha strangerRed wash over void — background well for danger text/banners. */
  dangerWell: "color-mix(in srgb, var(--color-stranger-red) 20%, var(--color-void))",
} as const;
