/**
 * Design tokens for Foghaven, mirroring docs/ART_BIBLE.md §3 (Palette) and §7
 * (Typography), plus spacing/radius/duration scales.
 *
 * This is the single source of truth. `tokens.css` is generated from this
 * file by `scripts/generate-tokens.ts` — never hand-edit tokens.css.
 */

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

// ---------------------------------------------------------------------------
// §3.5 Player Lantern Colours — order matches the doc table exactly. Position
// in this array is meaningful (indexed against player slots), so do not
// resort it alphabetically or otherwise.
// ---------------------------------------------------------------------------

export const lanternColors = [
  { id: "amber", name: "Amber", hex: "#FFB347" },
  { id: "crimson", name: "Crimson", hex: "#FF6B6B" },
  { id: "rose", name: "Rose", hex: "#FF9FC4" },
  { id: "violet", name: "Violet", hex: "#B98CFF" },
  { id: "cobalt", name: "Cobalt", hex: "#6BA8FF" },
  { id: "cyan", name: "Cyan", hex: "#5FE0DC" },
  { id: "jade", name: "Jade", hex: "#6FE09A" },
  { id: "lime", name: "Lime", hex: "#C8F06A" },
  { id: "bone", name: "Bone", hex: "#F2EAD8" },
  { id: "rust", name: "Rust", hex: "#E07A4A" },
  { id: "ash", name: "Ash", hex: "#9AA5B5" },
  { id: "plum", name: "Plum", hex: "#9B6BAA" },
  { id: "moss", name: "Moss", hex: "#8FA85C" },
  { id: "coral", name: "Coral", hex: "#FF8A7A" },
] as const;

export const colors = { ...core, ...materials, ...light, ...semantic } as const;

// ---------------------------------------------------------------------------
// §7 Typography
// ---------------------------------------------------------------------------

export const fonts = {
  display: { family: "'Alfa Slab One', serif", weight: 400 },
  ui: { family: "'Nunito', sans-serif", weightRegular: 700, weightBold: 800 },
  numeric: { family: "'JetBrains Mono', monospace", weight: 700 },
} as const;

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
} as const;

export type LanternColor = (typeof lanternColors)[number];
