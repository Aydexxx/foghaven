import { PALETTE } from "./palette";
import type { FramePose, Shape } from "./rig";
import { colors } from "../../theme/tokens";
import { hexNum } from "../../theme/phaserColor";

/**
 * How every cosmetic actually looks — the client-only counterpart to
 * `@foghaven/shared`'s `COSMETICS` (which only knows id/type/price). Keyed
 * by the same catalog id, the same relationship `archetypeId` strings have to
 * `ARCHETYPES_BY_ID`: the server and the shared config never need to know a
 * hat is shaped like a hat, only that it exists and costs 150 coins.
 *
 * ## The rule this whole file follows
 *
 * Every shape here is defined directly in rig-local space (the same
 * coordinate system `archetypes.ts`'s parts use — origin at the feet, head
 * centred at `(0, -36)`) and rendered as a small polygon *layered on top of*
 * the base sprite, positioned at a fixed offset from the player each frame —
 * exactly the mechanism `GameScene`'s player-colour badge already uses (see
 * `palette.ts`'s doc comment: "a separate, small accent badge... layered on
 * top rather than baked into the costume art itself"). Nothing here ever
 * touches an archetype's own `head`/`torso`/`arm`/`leg` polygons.
 *
 * That single rule is what keeps two requirements true at once, for free:
 *   - **No gameplay advantage.** These are additional draw calls positioned
 *     from a `pos` the game loop already computed; they never touch
 *     position, collision radius, or vision. There is no such thing as a
 *     cosmetic that makes you smaller, faster, or harder to see — the
 *     catalog is closed and every entry is additive by construction.
 *   - **Silhouette readability.** Every shape below is small — a few units,
 *     the same scale as the badge's 4px radius or the alderman's top-hat
 *     prop — and sits *outside or on top of* the archetype's own outline
 *     rather than replacing any part of it. The six costume silhouettes stay
 *     exactly as distinct as `archetypes.ts` designed them to be.
 *
 * Anchors are fixed rather than tracking the current animation frame's bone
 * transform, again matching the badge precisely: a hat "swims" very slightly
 * during a walk cycle rather than perfectly following head-bob, which is the
 * same trade-off the identity badge already makes and nobody has ever needed
 * to fix.
 */

/** Accent tones cosmetics may use that the base costume palette deliberately excludes — see `palette.ts`. */
export const COSMETIC_ACCENTS = {
  gold: hexNum(colors.voteGold),
  silver: hexNum(colors.foam),
  scarlet: hexNum(colors.strangerRed),
} as const;

// --- Hats: sit above the head (top of the head circle is ~y=-42.5). -------

export const HAT_VISUALS: Readonly<Record<string, Shape>> = {
  top_hat: {
    fill: PALETTE.ink,
    points: [
      { x: -4, y: -52 },
      { x: 4, y: -52 },
      { x: 4, y: -44 },
      { x: 7, y: -44 },
      { x: 7, y: -41 },
      { x: -7, y: -41 },
      { x: -7, y: -44 },
      { x: -4, y: -44 },
    ],
  },
  straw_boater: {
    fill: PALETTE.parchment,
    points: [
      { x: -3, y: -46 },
      { x: 3, y: -46 },
      { x: 3, y: -43 },
      { x: 8, y: -43 },
      { x: 8, y: -41 },
      { x: -8, y: -41 },
      { x: -8, y: -43 },
      { x: -3, y: -43 },
    ],
  },
  feathered_cap: {
    fill: PALETTE.slateMid,
    points: [
      { x: -5, y: -44 },
      { x: 5, y: -44 },
      { x: 5, y: -41 },
      { x: 2, y: -41 },
      { x: 6, y: -53 },
      { x: 3, y: -42 },
      { x: -5, y: -41 },
    ],
  },
};

// --- Accessories: face/neck level (head centre is y=-36). -----------------

export const ACCESSORY_VISUALS: Readonly<Record<string, Shape>> = {
  spectacles: {
    fill: PALETTE.ink,
    points: [
      { x: -4.5, y: -37 },
      { x: -2, y: -38.5 },
      { x: 2, y: -38.5 },
      { x: 4.5, y: -37 },
      { x: 4.5, y: -35.5 },
      { x: 2, y: -37 },
      { x: -2, y: -37 },
      { x: -4.5, y: -35.5 },
    ],
  },
  red_scarf: {
    fill: COSMETIC_ACCENTS.scarlet,
    points: [
      { x: -4, y: -31 },
      { x: 4, y: -31 },
      { x: 5, y: -27 },
      { x: -5, y: -27 },
    ],
  },
  eye_patch: {
    fill: PALETTE.ink,
    points: [
      { x: 2, y: -38 },
      { x: 6, y: -37 },
      { x: 5, y: -34 },
      { x: 1, y: -35 },
    ],
  },
};

// --- Pets: trail beside the player, near ground level. ---------------------

export const PET_VISUALS: Readonly<Record<string, Shape>> = {
  harbor_gull: {
    fill: PALETTE.parchment,
    points: [
      { x: -20, y: -4 },
      { x: -16, y: -6.5 },
      { x: -12, y: -4 },
      { x: -14, y: -1.5 },
      { x: -19, y: -1.5 },
    ],
  },
  tabby_cat: {
    fill: PALETTE.slateMid,
    points: [
      { x: -22, y: 2 },
      { x: -19, y: -3 },
      { x: -17, y: -1 },
      { x: -15, y: -3 },
      { x: -12, y: 2 },
      { x: -13, y: 6 },
      { x: -21, y: 6 },
    ],
  },
  hermit_crab: {
    fill: PALETTE.lantern,
    points: [
      { x: -21, y: 4 },
      { x: -17, y: 0.5 },
      { x: -13, y: 3 },
      { x: -14, y: 7 },
      { x: -20, y: 7 },
    ],
  },
};

// --- Outfits: a small chest trim, drawn inside the torso's own outline —
// a surface decal, never a shape that widens the silhouette. -----------------

export const OUTFIT_VISUALS: Readonly<Record<string, Shape>> = {
  brass_pin: {
    fill: COSMETIC_ACCENTS.gold,
    points: [
      { x: 0, y: -22 },
      { x: 2, y: -20 },
      { x: 0, y: -18 },
      { x: -2, y: -20 },
    ],
  },
  golden_sash: {
    fill: COSMETIC_ACCENTS.gold,
    points: [
      { x: -8, y: -28 },
      { x: -5, y: -30 },
      { x: 6, y: -14 },
      { x: 3, y: -12 },
    ],
  },
  silver_sash: {
    fill: COSMETIC_ACCENTS.silver,
    points: [
      { x: -8, y: -28 },
      { x: -5, y: -30 },
      { x: 6, y: -14 },
      { x: 3, y: -12 },
    ],
  },
};

// --- Death effects: a one-shot particle burst, not a Shape. -----------------

export interface DeathEffectVisual {
  color: number;
  particleCount: number;
  /** Roughly how far particles travel, in world units. */
  spread: number;
}

export const DEATH_EFFECT_VISUALS: Readonly<Record<string, DeathEffectVisual>> = {
  dust_puff: { color: PALETTE.slateLight, particleCount: 5, spread: 14 },
  spark_burst: { color: PALETTE.lantern, particleCount: 8, spread: 20 },
  feather_scatter: { color: PALETTE.parchment, particleCount: 6, spread: 18 },
};

// --- Victory poses: a single static frame, in the same `FramePose` shape
// animation frames use — consumed only by the results-screen preview
// (`rigPreview.ts`), never by the live scene (there is no live scene at
// game-over — see `GameOverScreen`). ----------------------------------------

export const VICTORY_POSE_VISUALS: Readonly<Record<string, FramePose>> = {
  triumphant_wave: {
    armR: { dy: -10, dx: 3, rotation: -0.9 },
    head: { dy: -1 },
  },
  bow: {
    body: { rotation: 0.35, dy: 1 },
  },
};

/** Fixed offsets pets sit at, one per side-flip; hats/accessories/outfits are drawn in rig-local space directly. */
export const PET_TRAIL_SMOOTHING = 0.12;
