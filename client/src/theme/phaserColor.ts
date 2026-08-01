/**
 * Pure hex-string parsing, deliberately with no `import Phaser` — several
 * callers (`characters/palette.ts` among them) compute these eagerly at
 * module scope, and Phaser's own module touches `window` as a side effect
 * of its device-detection singleton, which breaks any test importing that
 * chain outside a DOM environment. A 0xRRGGBB integer is just parsed hex;
 * it doesn't need Phaser to produce it.
 */

/** Converts a `tokens.ts` hex string (e.g. `colors.ink`) to the numeric form Phaser's color APIs expect. */
export function hexNum(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

/** Converts a `tokens.ts` hex string to a `"r,g,b"` triplet for building `rgba(...)` canvas-gradient strings. */
export function hexToRgbTriplet(hex: string): string {
  const n = hexNum(hex);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `${r},${g},${b}`;
}
