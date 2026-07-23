import { PLAYER_COLORS } from "@foghaven/shared";

/**
 * A color-blind-safe restyling of `PLAYER_COLORS`, same length and order —
 * index-for-index, so swapping a player's *displayed* color never changes
 * which `PLAYER_COLORS` index (and therefore which character archetype —
 * see `characters/assign.ts`, which hashes the server's original color, not
 * this one) they were dealt. Purely a client-side rendering concern; the
 * server's `PLAYER_COLORS` stays canonical for game logic.
 *
 * Based on the Okabe–Ito palette (the standard reference for a categorical
 * palette distinguishable across protanopia/deuteranopia/tritanopia),
 * extended with two further tones since Okabe–Ito has 8 and Foghaven needs
 * 10; its black is swapped for a light grey since a near-black badge would
 * vanish against this game's own near-black theme and its own stroke
 * outline (see `GameScene.ts`'s badge rendering).
 *
 * This is only half of the actual fix — see `GameScene.ts`'s badge number
 * glyph, which is unconditional and doesn't depend on this palette (or this
 * setting) at all, since even a well-chosen palette alone can't disambiguate
 * two players who hash onto the same character archetype shape.
 */
const COLOR_BLIND_PALETTE: readonly string[] = [
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#DDDDDD", // light grey (replaces Okabe-Ito black)
  "#999999", // mid grey
  "#8B4513", // brown
];

/** The player's stable index into `PLAYER_COLORS` — also what the badge number glyph shows. */
export function playerColorIndex(originalColor: string): number {
  return PLAYER_COLORS.indexOf(originalColor as (typeof PLAYER_COLORS)[number]);
}

/** `originalColor` unchanged unless `colorBlindMode` is on and it's a recognized player color, in which case its color-blind-safe counterpart. */
export function displayColorFor(originalColor: string, colorBlindMode: boolean): string {
  if (!colorBlindMode) {
    return originalColor;
  }
  const index = playerColorIndex(originalColor);
  return index >= 0 ? (COLOR_BLIND_PALETTE[index] ?? originalColor) : originalColor;
}
