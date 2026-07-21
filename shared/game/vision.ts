import {
  VISION_RADIUS_INDOOR,
  VISION_RADIUS_OUTDOOR,
  SABOTAGE_VISION_RADIUS,
} from "../config/gameConfig";
import { TILE, TILE_SIZE, tileKindAt } from "../map/townMap";
import type { Vec2 } from "./movement";

/**
 * The fog: who can see whom.
 *
 * This module is shared for the same reason `movement.ts` is: the server
 * uses it to decide what each client is *sent* (see the `filterChildren`
 * predicates on `GameState`), and the client uses the same numbers to draw
 * the fog overlay and gate its interaction prompts. One implementation, so
 * what is drawn, what is promptable, and what is transmitted can never
 * disagree — the visual fog is presentation, but *this* is the boundary the
 * data actually stops at.
 */

/**
 * How finely a sight line is sampled against the tile grid, in world units.
 * A quarter tile: every wall in the town is a full 32-unit tile, so an
 * 8-unit step cannot cross one unnoticed — at worst a ray grazes a wall's
 * corner within 8 units of its edge, which reads as generous corner-peeking
 * rather than seeing through anything.
 */
const LOS_SAMPLE_STEP = TILE_SIZE / 4;

/**
 * How far someone standing at `pos` can see: short in the outdoor fog,
 * longer under a roof.
 *
 * The radius is the *viewer's*, decided by the viewer's own tile — which
 * makes sight deliberately asymmetric at a lit doorway: from inside the
 * tavern you can watch a figure out in the fog before they can make you
 * out. That is flavour, not an oversight; it is also how this genre
 * conventionally works (your light, your vision).
 */
export function visionRadiusAt(pos: Vec2, sabotageActive = false): number {
  if (sabotageActive) {
    return SABOTAGE_VISION_RADIUS;
  }
  return tileKindAt(pos.x, pos.y) === TILE.STREET
    ? VISION_RADIUS_OUTDOOR
    : VISION_RADIUS_INDOOR;
}

/**
 * Whether an unbroken straight line runs from `a` to `b` — walls block
 * sight exactly as they block movement, and off-grid space counts as wall.
 * Interior samples only: both endpoints are player centres, which are
 * always on floor.
 */
export function hasLineOfSight(a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.ceil(Math.hypot(dx, dy) / LOS_SAMPLE_STEP);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (tileKindAt(a.x + dx * t, a.y + dy * t) === TILE.WALL) {
      return false;
    }
  }
  return true;
}

/**
 * The complete visibility rule: within the viewer's radius for the ground
 * they stand on, and with no wall in between. Pure geometry — everything
 * situational (dead players see everything, the fog lifts outside of
 * play, you always see yourself) lives with the callers, because those
 * rules differ between the server's filter and the client's prompts.
 */
export function canSee(viewer: Vec2, target: Vec2, sabotageActive = false): boolean {
  const dx = target.x - viewer.x;
  const dy = target.y - viewer.y;
  if (Math.hypot(dx, dy) > visionRadiusAt(viewer, sabotageActive)) {
    return false;
  }
  return hasLineOfSight(viewer, target);
}
