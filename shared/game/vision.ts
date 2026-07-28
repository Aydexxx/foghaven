import {
  VISION_RADIUS_INDOOR,
  VISION_RADIUS_OUTDOOR,
  SABOTAGE_VISION_RADIUS,
  LANTERN_EXTINGUISHED_VISION_MULTIPLIER,
  LANTERN_EXTINGUISHED_DETECTION_RADIUS,
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
 * docs/ART_BIBLE.md §3.5/§6.2: every Havener's own vision originates from
 * their lantern, not just what they cosmetically carry.
 *
 *   - `lit` — normal.
 *   - `flickering` — a visual tell only. Reserved for a future trigger (a
 *     sabotage warning, low fuel, whatever lands later) — deliberately
 *     identical to `lit` here. Do not give this state its own numbers until
 *     something actually sets it; a mechanic nobody can explain from the UI
 *     yet is worse than no mechanic.
 *   - `extinguished` — voluntarily doused. Both halves of the trade must be
 *     felt: `visionRadiusAt` shrinks the DOUSER's own sight sharply, and
 *     `canSee` separately caps how far away anyone else can spot them,
 *     regardless of the *viewer's* own radius. One without the other is a
 *     broken mechanic (a shrunken radius alone still lets a extinguished
 *     player be spotted from across a room; a detection cap alone gives no
 *     downside to hiding).
 *   - `dropped` — detached and on the ground (the death sequence's
 *     signature moment — see `Havener.dropLantern`). Not a distinct vision
 *     rule of its own: a dead player already bypasses the fog entirely (see
 *     `GameState.players`'s filter — the dead see everyone), so this value
 *     exists for the client to render, not for `canSee` to special-case.
 */
export type LanternState = "lit" | "flickering" | "extinguished" | "dropped";

/** Anything with a position and a lantern — what `visionRadiusAt`/`canSee` need from either side of a sight check. */
export interface LitPosition extends Vec2 {
  lanternState: LanternState;
}

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
 * longer under a roof — then cut sharply if their OWN lantern is
 * extinguished, per §6.2/§3.5: "a player's own vision radius originates
 * from their lantern."
 *
 * The radius is the *viewer's*, decided by the viewer's own tile — which
 * makes sight deliberately asymmetric at a lit doorway: from inside the
 * tavern you can watch a figure out in the fog before they can make you
 * out. That is flavour, not an oversight; it is also how this genre
 * conventionally works (your light, your vision).
 */
export function visionRadiusAt(pos: LitPosition, sabotageActive = false): number {
  const base = sabotageActive
    ? SABOTAGE_VISION_RADIUS
    : tileKindAt(pos.x, pos.y) === TILE.STREET
      ? VISION_RADIUS_OUTDOOR
      : VISION_RADIUS_INDOOR;
  return pos.lanternState === "extinguished" ? base * LANTERN_EXTINGUISHED_VISION_MULTIPLIER : base;
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
 * they stand on and their own lantern, within the TARGET's own detection
 * range if the target is extinguished, and with no wall in between. Pure
 * geometry — everything situational (dead players see everything, the fog
 * lifts outside of play, you always see yourself) lives with the callers,
 * because those rules differ between the server's filter and the client's
 * prompts.
 *
 * The target-side check is the other half of "extinguished ... much harder
 * for others to see you": an extinguished target caps how close someone has
 * to be to spot them at all, independent of how far the viewer could
 * otherwise see. It never overrides `KILL_RANGE`/`REPORT_BODY_RANGE` — both
 * comfortably clear `LANTERN_EXTINGUISHED_DETECTION_RADIUS`, the same
 * invariant `VISION_RADIUS_*`'s own doc already protects — extinguishing
 * makes you hard to spot from a distance, not untouchable at melee range.
 */
export function canSee(viewer: LitPosition, target: LitPosition, sabotageActive = false): boolean {
  const dx = target.x - viewer.x;
  const dy = target.y - viewer.y;
  const distance = Math.hypot(dx, dy);
  if (distance > visionRadiusAt(viewer, sabotageActive)) {
    return false;
  }
  if (target.lanternState === "extinguished" && distance > LANTERN_EXTINGUISHED_DETECTION_RADIUS) {
    return false;
  }
  return hasLineOfSight(viewer, target);
}
