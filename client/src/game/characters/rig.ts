/**
 * The character rig: types shared by every archetype and animation.
 *
 * Every character is the same skeleton — head, torso, two arm nubs, two leg
 * nubs, one prop — redrawn with a different torso silhouette and a
 * different prop per archetype. Animation is a shared table of per-part
 * offsets applied on top of each archetype's own rest geometry, which is
 * what makes "one skeleton, six costumes" actually true in the code and not
 * just in the art direction doc.
 */

export interface Point {
  x: number;
  y: number;
}

/** Named attachment points on the skeleton, in rig-local space (origin = feet, +y = up is negated — see `RIG_ORIGIN_Y`). */
export type PartName = "head" | "torso" | "armL" | "armR" | "legL" | "legR" | "prop";

/** A flat-shaded polygon, plus the two palette colours it's drawn with. */
export interface Shape {
  points: Point[];
  fill: number;
  /** Omit to use the archetype's default outline colour. */
  stroke?: number;
}

/**
 * One archetype's rest pose: a shape for every part except `prop`, which is
 * optional (not every archetype needs one drawn as its own part — though
 * all six here do) and carries a `behindTorso` flag for accessories that
 * should peek out from behind the body (a rucksack) rather than sit in
 * front of it (a lantern, a bag).
 */
export interface ArchetypeRig {
  id: string;
  /** Muted base garment tone — see `palette.ts`. Used for `torso` unless the shape specifies its own fill. */
  outline: number;
  parts: Record<Exclude<PartName, "prop">, Shape>;
  prop?: Shape & { behindTorso?: boolean };
}

/** Per-part offset for a single animation frame: translate, rotate (radians), and optionally scale. */
export interface PartPose {
  dx?: number;
  dy?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * One frame of an animation: a per-part offset for whichever parts move
 * independently (a swinging arm, a lifted leg — pivoting around that
 * part's own centroid), plus an optional `body` transform applied to every
 * part afterward, pivoting around the rig origin (the feet). The two are
 * different tools for different motions: limbs articulate around
 * themselves, but a character toppling over or drifting as a ghost has to
 * move as one rigid whole, pivoting at the ground contact point — rotating
 * each limb independently around its own centre would fly the body apart
 * instead of tipping it over.
 */
export interface FramePose extends Partial<Record<PartName, PartPose>> {
  body?: PartPose;
}

/**
 * Every frame cell in the generated atlas is this big, and `RIG_ORIGIN` is
 * where the ground-contact point (the rig's local (0, 0)) sits within it.
 * Sized with real clearance to spare: the farthest any rig point sits from
 * the origin is the alderman's top hat at 47 units, and the death
 * animation swings the whole rig up to ~55° around that same origin — a
 * tight cell would clip the hat mid-fall. 100px gives roughly 50px of
 * clearance in every direction, comfortably covering that swing without
 * hand-verifying the exact rotated extent of every prop on every archetype.
 */
export const FRAME_SIZE = 100;
export const RIG_ORIGIN = { x: 50, y: 76 };

function rotate(p: Point, radians: number): Point {
  if (!radians) {
    return p;
  }
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/**
 * Apply a frame's transform to a part's rest-pose points, in rig-local
 * space (before the shared `RIG_ORIGIN` offset — see `spriteSheet.ts`).
 * Rotation and scale pivot around the shape's own centroid, not the rig
 * origin, so a swinging arm swings from its shoulder, not from the
 * character's feet.
 */
export function posePoints(points: Point[], pose: PartPose | undefined): Point[] {
  if (!pose) {
    return points;
  }
  const { dx = 0, dy = 0, rotation = 0, scaleX = 1, scaleY = 1 } = pose;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return points.map((p) => {
    const local = { x: (p.x - cx) * scaleX, y: (p.y - cy) * scaleY };
    const rotated = rotate(local, rotation);
    return { x: cx + rotated.x + dx, y: cy + rotated.y + dy };
  });
}

/**
 * Apply the whole-rig `body` transform: unlike `posePoints`, this always
 * pivots around the rig origin (0, 0) — the feet — regardless of which part
 * it's applied to. That shared pivot is what makes a death collapse read as
 * one body toppling over its own feet rather than each limb spinning off on
 * its own.
 */
export function applyBodyTransform(points: Point[], body: PartPose | undefined): Point[] {
  if (!body) {
    return points;
  }
  const { dx = 0, dy = 0, rotation = 0, scaleX = 1, scaleY = 1 } = body;
  return points.map((p) => {
    const scaled = { x: p.x * scaleX, y: p.y * scaleY };
    const rotated = rotate(scaled, rotation);
    return { x: rotated.x + dx, y: rotated.y + dy };
  });
}
