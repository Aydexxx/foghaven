import { PLAYER_SPEED, PLAYER_RADIUS, MAP } from "../config/gameConfig";
import { isWalkableRegion, isPointInLockedDoor } from "../map/townMap";

export interface Vec2 {
  x: number;
  y: number;
}

/** A movement intent: each axis is one of -1, 0, or 1. */
export interface Direction {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Reduce arbitrary client-supplied input to a canonical -1/0/1 intent on each
 * axis. This is a trust boundary: a client cannot smuggle a larger magnitude
 * (to move faster) or a fractional value — only a direction survives.
 */
export function sanitizeDirection(x: unknown, y: unknown): Direction {
  return { x: axis(x), y: axis(y) };
}

function axis(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/**
 * Advance a position by one input command. Diagonals are normalised so
 * movement speed is constant in every direction. Each axis is resolved
 * independently against the town's walls — a diagonal move into a wall
 * slides along it rather than stopping dead, the same reason any top-down
 * game resolves collision this way — and the result is always clamped to the
 * outer map rectangle as a last-resort backstop.
 *
 * This is the one function server and client both call with the same
 * `SIM_DT`, which is what keeps client prediction in lockstep with the
 * authoritative simulation. Because collision lives here rather than in
 * `GameRoom` itself, the server enforces it for free: there is no separate
 * "server-side wall check" to fall out of sync with what the client predicts
 * or the map renders.
 */
export function applyInput(pos: Vec2, dir: Direction, dt: number): Vec2 {
  let dx = dir.x;
  let dy = dir.y;

  const length = Math.hypot(dx, dy);
  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  let x = pos.x;
  let y = pos.y;

  const nx = clamp(x + dx * PLAYER_SPEED * dt, PLAYER_RADIUS, MAP.width - PLAYER_RADIUS);
  if (isWalkableRegion(nx, y, PLAYER_RADIUS)) {
    x = nx;
  }

  const ny = clamp(y + dy * PLAYER_SPEED * dt, PLAYER_RADIUS, MAP.height - PLAYER_RADIUS);
  if (isWalkableRegion(x, ny, PLAYER_RADIUS)) {
    y = ny;
  }

  return { x, y };
}

/**
 * `applyInput`, additionally reverting to the pre-move position if it would
 * land inside a Saboteur-locked door. A thin wrapper rather than a change to
 * `applyInput` itself, on purpose: `applyInput` is what every existing
 * movement test pins, and an empty `lockedRoomSlugs` (the overwhelming
 * majority of games, since Saboteur is opt-in) makes this a pure passthrough
 * with zero behavior change. Client prediction and server simulation both
 * call this instead of `applyInput` directly so a locked door blocks movement
 * identically on both sides.
 */
export function applyInputWithLocks(
  pos: Vec2,
  dir: Direction,
  dt: number,
  lockedRoomSlugs: readonly string[],
): Vec2 {
  const next = applyInput(pos, dir, dt);
  if (isPointInLockedDoor(next.x, next.y, lockedRoomSlugs)) {
    return pos;
  }
  return next;
}
