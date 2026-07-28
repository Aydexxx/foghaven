/**
 * The six named character anchor points from docs/ART_BIBLE.md §4.3.
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH for where cosmetics attach. §4.3 is
 * explicit that these positions "are fixed and must never move between
 * assets" — so no anchor offset may be written anywhere else in the codebase.
 * Everything the Havener composite draws is placed through `anchorLocal()`.
 *
 * Coordinates are in the §4.1 128×128 source canvas: origin top-left, +y
 * down, feet at y=112. `anchorLocal()` re-expresses them relative to the feet
 * (the Havener's own local origin), which is the point a player's world
 * position denotes.
 */

/** §4.1: the source canvas the anchors are measured in. */
export const SOURCE_SIZE = 128;

/**
 * §4.1: "Character occupies ~96 px of height... feet at y=112." The rendered
 * body art is scaled to this height so the fixed §4.3 anchors land on it
 * regardless of the raw asset's own dimensions — see `Havener`.
 */
export const CHARACTER_HEIGHT = 96;

export type AnchorName = "crown" | "face" | "chest" | "hand" | "back" | "feet";

/** §4.3, verbatim. Do not edit values without updating the Art Bible first (§2 rule 5, §4.3). */
export const ANCHORS = {
  crown: { x: 64, y: 26 },
  face: { x: 64, y: 46 },
  chest: { x: 64, y: 70 },
  hand: { x: 44, y: 78 },
  back: { x: 64, y: 66 },
  feet: { x: 64, y: 112 },
} as const satisfies Record<AnchorName, { readonly x: number; readonly y: number }>;

/** The feet anchor is also the composite's local origin (a player's (x,y) is their feet). */
export const FEET = ANCHORS.feet;

/**
 * An anchor's position in Havener-local space: measured from the feet, with
 * +y still downward (Phaser screen space). A hat at crown (64,26) becomes
 * (0, -86) — 86 px above the feet.
 */
export function anchorLocal(name: AnchorName): { x: number; y: number } {
  const a = ANCHORS[name];
  return { x: a.x - FEET.x, y: a.y - FEET.y };
}
