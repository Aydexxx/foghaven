import { PLAYER_COLORS } from "@foghaven/shared";
import { COLOR_BLIND_PALETTE } from "../theme/colorBlindPalette";

/**
 * A color-blind-safe restyling of `PLAYER_COLORS`, same length and order —
 * index-for-index, so swapping a player's *displayed* color never changes
 * which `PLAYER_COLORS` index (and therefore which character archetype —
 * see `characters/assign.ts`, which hashes the server's original color, not
 * this one) they were dealt. Purely a client-side rendering concern; the
 * server's `PLAYER_COLORS` stays canonical for game logic. The actual
 * palette lives in `theme/colorBlindPalette.ts` — see its doc for why it's
 * a fixed scientific reference rather than an ART_BIBLE §3 remap.
 *
 * This is only half of the actual fix — see `GameScene.ts`'s badge number
 * glyph, which is unconditional and doesn't depend on this palette (or this
 * setting) at all, since even a well-chosen palette alone can't disambiguate
 * two players who hash onto the same character archetype shape.
 */

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
