import { colors } from "../../theme/tokens";
import { hexNum } from "../../theme/phaserColor";

/**
 * The character art's restricted palette — deliberately not the rainbow of
 * `PLAYER_COLORS`. Every archetype is built from these seven ART_BIBLE §3
 * tones only, so six very differently-shaped silhouettes still read as one
 * consistent, slightly worn, coastal-town cast rather than six unrelated
 * clip-art pastes. Per-player identity is a separate, small accent badge
 * tinted with the player's own colour — see `GameScene`'s
 * `createAccentBadge` — layered on top rather than baked into the costume
 * art itself.
 */
export const PALETTE = {
  /** Deep fog-blue-grey — the coastal-night base every silhouette reads against. */
  slateDark: hexNum(colors.fogDark),
  /** Mid fog-blue-grey — the most common garment tone (coats, trousers). */
  slateMid: hexNum(colors.fogMid),
  /** Pale blue-grey — light garments, undersides, highlights. */
  slateLight: hexNum(colors.mist),
  /** Warm lantern-yellow — the one warm accent: lantern glow, brass, buttons. */
  lantern: hexNum(colors.flameGlow),
  /** Weathered rope-tan — aprons, collars, bandages, parchment. */
  parchment: hexNum(colors.ropeTan),
  /** Muted skin tone — heads and hands, kept flat and desaturated on purpose. */
  skin: hexNum(colors.woodLight),
  /** Near-black outline/shadow tone used for strokes and deep shadow shapes. */
  ink: hexNum(colors.ink),
} as const;

export type PaletteColor = (typeof PALETTE)[keyof typeof PALETTE];
