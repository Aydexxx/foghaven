import type { FramePose } from "./rig";

/**
 * The shared animation frame tables — one set of offsets applied to
 * whichever archetype is being drawn, which is what "one skeleton, six
 * costumes" actually means for animation: a walk cycle authored once works
 * on the fisherman's wide coat and the doctor's trim one alike, because it
 * only ever moves the shared arm/leg/head/torso parts by the same amounts.
 *
 * Order matters: `spriteSheet.ts` lays frames out in exactly this sequence
 * within each archetype's row of the atlas.
 */

/** Breathing — a small vertical lift, nothing else moves. */
export const IDLE_FRAMES: FramePose[] = [
  {},
  { head: { dy: -1 }, torso: { dy: -0.7, scaleY: 1.02 } },
];

/**
 * A four-beat march: contact-left, passing, contact-right, passing. Legs
 * alternate forward/back with a small lift; arms swing opposite the leg on
 * their own side, the way a real gait counterbalances; the torso dips
 * slightly on each contact frame.
 */
export const WALK_FRAMES: FramePose[] = [
  { legL: { dx: -2, dy: -1 }, legR: { dx: 2 }, armL: { dx: 2 }, armR: { dx: -2 }, torso: { dy: -0.5 } },
  { legL: { dx: -1 }, legR: { dx: 1 } },
  { legL: { dx: 2 }, legR: { dx: -2, dy: -1 }, armL: { dx: -2 }, armR: { dx: 2 }, torso: { dy: -0.5 } },
  { legL: { dx: 1 }, legR: { dx: -1 } },
];

/** Working at something: a forward lean with the working hand tipping back and forth. */
export const TASK_FRAMES: FramePose[] = [
  { torso: { dy: 1, rotation: 0.05 }, head: { dy: 1 }, armR: { dy: 2, dx: 1 } },
  { torso: { dy: 2, rotation: -0.03 }, head: { dy: 2 }, armR: { dx: -1 }, armL: { dy: 1 } },
];

/**
 * The collapse: upright and stiff, then toppling, then down. All three
 * frames drive the whole-rig `body` transform (pivoting at the feet, see
 * `applyBodyTransform`) rather than posing individual limbs — a fall is one
 * rigid body going over, not each part moving independently.
 */
export const DEATH_FRAMES: FramePose[] = [
  { torso: { scaleY: 1.03 } },
  { body: { rotation: 0.5, dy: 2 } },
  { body: { rotation: 0.95, dy: 5 } },
];

/** A slow, weightless drift — the whole rig sways rather than any one part. */
export const GHOST_FRAMES: FramePose[] = [
  { body: { dy: -2 } },
  { body: { dy: 2, dx: 1, rotation: 0.05 } },
];

export const ANIMATION_TABLE = {
  idle: IDLE_FRAMES,
  walk: WALK_FRAMES,
  task: TASK_FRAMES,
  death: DEATH_FRAMES,
  ghost: GHOST_FRAMES,
} as const;

export type AnimationName = keyof typeof ANIMATION_TABLE;
