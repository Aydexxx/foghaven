/**
 * Based on the Okabe–Ito palette (the standard reference for a categorical
 * palette distinguishable across protanopia/deuteranopia/tritanopia),
 * extended with two further tones since Okabe–Ito has 8 and Foghaven needs
 * 10; its black is swapped for a light grey since a near-black badge would
 * vanish against this game's own near-black theme and its own stroke
 * outline (see `game/GameScene.ts`'s badge rendering).
 *
 * A fixed scientific reference palette, not an ART_BIBLE §3 colour set —
 * it answers a different question (distinguishability under colour-vision
 * deficiency) than "what does the world look like", so it is its own
 * dedicated token list rather than a remap onto §3. Order is index-stable
 * against `PLAYER_COLORS` — see `graphics/colorBlindPalette.ts` — and must
 * never be resorted.
 */
export const COLOR_BLIND_PALETTE: readonly string[] = [
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
] as const;
