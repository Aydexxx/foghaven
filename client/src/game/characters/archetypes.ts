import { PALETTE } from "./palette";
import type { ArchetypeRig, Point, Shape } from "./rig";

/**
 * The six archetypes. Every one shares the exact same head, arms and legs
 * (defined once below) — the only things that ever change are the torso
 * outline and the one attached prop, which is deliberate: silhouette
 * variety has to come from genuinely different shapes, not from recolouring
 * the same blob, and holding everything else constant is what makes that
 * honest (there's nowhere left to cheat the difference in).
 *
 * Design notes per archetype — what specifically makes each one readable as
 * a flat shadow with no colour at all:
 *   - fisherman: wide, boxy, flares at the hem; a net-bundle bump at the hip.
 *   - lamplighter: the narrowest torso of the six; a floating lantern-glow
 *     beside the hand — the one place the warm accent colour appears as a
 *     silhouette-defining shape, not just decoration.
 *   - tavernKeeper: a round barrel torso — the only rounded one.
 *   - doctor: a straight-edged, unflared column; a satchel bump breaks the
 *     hip on one side only.
 *   - alderman: the tallest point in the set (a top hat, well above every
 *     other head) and a forked, two-pronged hem — no one else has a notch
 *     cut into their outline.
 *   - drifter: deliberately asymmetric — uneven shoulders, a jagged hem —
 *     plus the widest single prop (an oversized pack peeking out from
 *     behind on both sides).
 */

function circlePoints(cx: number, cy: number, radius: number, sides = 10): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

const HEAD: Shape = { points: circlePoints(0, -36, 6.5), fill: PALETTE.skin };
const ARM_L: Shape = { points: [{ x: -13.5, y: -27 }, { x: -8.5, y: -27 }, { x: -8.5, y: -19 }, { x: -13.5, y: -19 }], fill: PALETTE.skin };
const ARM_R: Shape = { points: [{ x: 8.5, y: -27 }, { x: 13.5, y: -27 }, { x: 13.5, y: -19 }, { x: 8.5, y: -19 }], fill: PALETTE.skin };
const LEG_L: Shape = { points: [{ x: -7, y: -10 }, { x: -2, y: -10 }, { x: -1, y: 0 }, { x: -8, y: 0 }], fill: PALETTE.slateDark };
const LEG_R: Shape = { points: [{ x: 2, y: -10 }, { x: 7, y: -10 }, { x: 8, y: 0 }, { x: 1, y: 0 }], fill: PALETTE.slateDark };

export const ARCHETYPES: readonly ArchetypeRig[] = [
  {
    id: "fisherman",
    outline: PALETTE.ink,
    parts: {
      head: HEAD,
      armL: ARM_L,
      armR: ARM_R,
      legL: LEG_L,
      legR: LEG_R,
      torso: {
        fill: PALETTE.slateDark,
        points: [
          { x: -11, y: -32 },
          { x: 11, y: -32 },
          { x: 14, y: -14 },
          { x: 16, y: -9 },
          { x: -16, y: -9 },
          { x: -14, y: -14 },
        ],
      },
    },
    // A coiled net bundle at the hip — a silhouette bump nothing else has there.
    prop: {
      fill: PALETTE.parchment,
      points: [
        { x: 9, y: -17 },
        { x: 18, y: -16 },
        { x: 19, y: -8 },
        { x: 8, y: -8 },
      ],
    },
  },
  {
    id: "lamplighter",
    outline: PALETTE.ink,
    parts: {
      head: HEAD,
      armL: ARM_L,
      armR: ARM_R,
      legL: LEG_L,
      legR: LEG_R,
      // The narrowest torso in the set — the "tall and thin" read comes
      // from this, not from being drawn any taller than anyone else.
      torso: {
        fill: PALETTE.slateMid,
        points: [
          { x: -6, y: -32 },
          { x: 6, y: -32 },
          { x: 7, y: -10 },
          { x: -7, y: -10 },
        ],
      },
    },
    // A held lantern's glow — the only place the warm accent is a shape,
    // not a decal, and the single most identifiable prop in the cast.
    prop: {
      fill: PALETTE.lantern,
      points: [
        { x: 13, y: -30 },
        { x: 18, y: -35 },
        { x: 23, y: -30 },
        { x: 18, y: -25 },
      ],
    },
  },
  {
    id: "tavernKeeper",
    outline: PALETTE.ink,
    parts: {
      head: HEAD,
      armL: ARM_L,
      armR: ARM_R,
      legL: LEG_L,
      legR: LEG_R,
      // The only rounded torso of the six — a barrel, not a coat.
      torso: {
        fill: PALETTE.slateLight,
        points: [
          { x: -8, y: -32 },
          { x: 8, y: -32 },
          { x: 13, y: -20 },
          { x: 13, y: -11 },
          { x: 9, y: -9 },
          { x: -9, y: -9 },
          { x: -13, y: -11 },
          { x: -13, y: -20 },
        ],
      },
    },
    // An apron front panel — sits inside the torso's own outline, so it's
    // a surface detail rather than a silhouette change; the roundness
    // alone already makes this one unmistakable.
    prop: {
      fill: PALETTE.parchment,
      points: [
        { x: -9, y: -20 },
        { x: 9, y: -20 },
        { x: 7, y: -9 },
        { x: -7, y: -9 },
      ],
    },
  },
  {
    id: "doctor",
    outline: PALETTE.ink,
    parts: {
      head: HEAD,
      armL: ARM_L,
      armR: ARM_R,
      legL: LEG_L,
      legR: LEG_R,
      // Straight-edged, unflared, uncurved — the "trim coat" read.
      torso: {
        fill: PALETTE.slateLight,
        points: [
          { x: -9, y: -32 },
          { x: 9, y: -32 },
          { x: 9, y: -9 },
          { x: -9, y: -9 },
        ],
      },
    },
    // The bag hangs off one hip only — the torso is otherwise perfectly
    // symmetric, so this single asymmetric bump is the whole tell.
    prop: {
      fill: PALETTE.ink,
      points: [
        { x: -16, y: -18 },
        { x: -9, y: -19 },
        { x: -8, y: -10 },
        { x: -15, y: -9 },
      ],
    },
  },
  {
    id: "alderman",
    outline: PALETTE.ink,
    parts: {
      head: HEAD,
      armL: ARM_L,
      armR: ARM_R,
      legL: LEG_L,
      legR: LEG_R,
      // A fitted waist that forks into two tailcoat tails at the hem — a
      // notch cut into the outline nothing else in the cast has.
      torso: {
        fill: PALETTE.slateDark,
        points: [
          { x: -8, y: -32 },
          { x: 8, y: -32 },
          { x: 9, y: -16 },
          { x: 9, y: -9 },
          { x: 3, y: -9 },
          { x: 2, y: -14 },
          { x: -2, y: -14 },
          { x: -3, y: -9 },
          { x: -9, y: -9 },
          { x: -9, y: -16 },
        ],
      },
    },
    // The top hat: the tallest single point of any archetype, sitting
    // above the head rather than beside the body — a silhouette that reads
    // even from a distance, before any other detail resolves.
    prop: {
      fill: PALETTE.ink,
      points: [
        { x: -5, y: -47 },
        { x: 5, y: -47 },
        { x: 5, y: -40 },
        { x: -5, y: -40 },
      ],
    },
  },
  {
    id: "drifter",
    outline: PALETTE.ink,
    parts: {
      head: HEAD,
      armL: ARM_L,
      armR: ARM_R,
      legL: LEG_L,
      legR: LEG_R,
      // Deliberately asymmetric: uneven shoulders and a jagged, notched
      // hem — irregularity itself is the tell, where every other
      // archetype is built from clean, regular shapes.
      torso: {
        fill: PALETTE.slateMid,
        points: [
          { x: -9, y: -33 },
          { x: 6, y: -31 },
          { x: 10, y: -18 },
          { x: 9, y: -9 },
          { x: 2, y: -11 },
          { x: -4, y: -9 },
          { x: -10, y: -16 },
        ],
      },
    },
    // The biggest prop of any archetype, and the only one drawn behind the
    // torso — a lumpy pack that peeks out past both shoulders.
    prop: {
      fill: PALETTE.parchment,
      behindTorso: true,
      points: [
        { x: -13, y: -32 },
        { x: 13, y: -32 },
        { x: 15, y: -14 },
        { x: 11, y: -7 },
        { x: -11, y: -7 },
        { x: -15, y: -14 },
      ],
    },
  },
];

export const ARCHETYPES_BY_ID: ReadonlyMap<string, ArchetypeRig> = new Map(
  ARCHETYPES.map((a) => [a.id, a]),
);
