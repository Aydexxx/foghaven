/**
 * The character art's restricted palette — deliberately not the rainbow of
 * `PLAYER_COLORS`. Every archetype is built from these seven tones only, so
 * six very differently-shaped silhouettes still read as one consistent,
 * slightly worn, coastal-town cast rather than six unrelated clip-art
 * pastes. Per-player identity is a separate, small accent badge tinted with
 * the player's own colour — see `GameScene`'s `createAccentBadge` — layered
 * on top rather than baked into the costume art itself.
 */
export const PALETTE = {
  /** Deep slate-blue-grey — the coastal-night base every silhouette reads against. */
  slateDark: 0x2c3440,
  /** Mid blue-grey — the most common garment tone (coats, trousers). */
  slateMid: 0x4a5568,
  /** Pale blue-grey — light garments, undersides, highlights. */
  slateLight: 0x8a97a8,
  /** Warm lantern-yellow — the one warm accent: lantern glow, brass, buttons. */
  lantern: 0xe8b64c,
  /** Weathered cream — aprons, collars, bandages, parchment. */
  parchment: 0xdcd0b4,
  /** Muted skin tone — heads and hands, kept flat and desaturated on purpose. */
  skin: 0xc9a882,
  /** Near-black outline/shadow tone used for strokes and deep shadow shapes. */
  ink: 0x14181f,
} as const;

export type PaletteColor = (typeof PALETTE)[keyof typeof PALETTE];
