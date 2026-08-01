/**
 * Shared four-tile identification palette for the pattern-memory and
 * wire-connecting mini-games. Deliberately bright and maximally
 * distinguishable at a glance — the opposite goal of the muted ART_BIBLE §3
 * world/UI palette — so these are their own dedicated token list rather
 * than a remap onto §3, same idiom as `colorBlindPalette.ts`. Previously
 * declared twice, once per mini-game, as identical literal arrays.
 */
export const MINIGAME_TILE_COLORS: readonly string[] = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
];
