import {
  PLAYER_SPEED,
  PLAYER_RADIUS,
  MAP,
  INJURED_SPEED_MULTIPLIER,
  PLAYER_CONDITION,
  type PlayerCondition,
} from "../config/gameConfig";
import { isWalkableRegion, isPointInLockedDoor, isInsideLobby } from "../map/townMap";

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
 *
 * `speedScale` multiplies `PLAYER_SPEED` — 1 for a healthy player,
 * `INJURED_SPEED_MULTIPLIER` for an injured one. It rides through here rather
 * than being applied by either caller for exactly the lockstep reason above:
 * a limp the server simulates but the client does not predict is a
 * rubber-banding bug, not a slower player. Both sides read it from the same
 * public `Player.condition`, so neither has to be told.
 *
 * Defaulted to 1 so every existing caller and test is unaffected.
 */
export function applyInput(
  pos: Vec2,
  dir: Direction,
  dt: number,
  speedScale = 1,
): Vec2 {
  let dx = dir.x;
  let dy = dir.y;

  const length = Math.hypot(dx, dy);
  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  let x = pos.x;
  let y = pos.y;

  const speed = PLAYER_SPEED * speedScale;
  const nx = clamp(x + dx * speed * dt, PLAYER_RADIUS, MAP.width - PLAYER_RADIUS);
  if (isWalkableRegion(nx, y, PLAYER_RADIUS)) {
    x = nx;
  }

  const ny = clamp(y + dy * speed * dt, PLAYER_RADIUS, MAP.height - PLAYER_RADIUS);
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
  speedScale = 1,
): Vec2 {
  const next = applyInput(pos, dir, dt, speedScale);
  if (isPointInLockedDoor(next.x, next.y, lockedRoomSlugs)) {
    return pos;
  }
  return next;
}

/**
 * `applyInput`, additionally confined to the Tavern — lobby movement only.
 *
 * The Tavern's doorways are ordinary walkable tiles in the collision grid
 * (they have to be: the same room is a real room during a round), so without
 * this a waiting player could simply walk out into the plaza — off the
 * lobby's fixed camera, out of the room everyone else is standing in, and
 * into a town that isn't running yet.
 *
 * Same shape and same reasoning as `applyInputWithLocks`: a thin wrapper
 * rather than a flag inside `applyInput`, so the ordinary movement path that
 * every existing test pins is untouched, and both client prediction and
 * server simulation call this identical function while the phase is LOBBY —
 * which is what keeps the wall in the same place on both sides.
 *
 * The rule is "you cannot LEAVE the Tavern", not "you must be in it": a
 * player who is already outside moves normally. Production never produces
 * that case (every lobby position comes from `lobbySpawn`, inside the room),
 * so this costs nothing there — but making the confinement one-directional
 * means the function can never strand a player in place, which a bare
 * inside-only test would do to anyone who somehow started outside.
 */
export function applyLobbyInput(pos: Vec2, dir: Direction, dt: number): Vec2 {
  // No `speedScale`: the lobby is pre-round, where nobody has a condition yet
  // (`returnToLobby` and `onJoin` both reset everyone to healthy), so there is
  // no limp to carry into it and no reason to give callers a knob that would
  // always be 1.
  const next = applyInput(pos, dir, dt);
  if (!isInsideLobby(pos.x, pos.y, PLAYER_RADIUS)) {
    return next;
  }
  return isInsideLobby(next.x, next.y, PLAYER_RADIUS) ? next : pos;
}

/**
 * The `speedScale` for a player in a given condition — the one place the
 * healthy/injured mapping is made, so the server simulation and the client's
 * prediction cannot disagree about how fast a limp is.
 *
 * Takes the condition rather than the whole player so it stays callable from
 * both sides: the server holds a schema `Player`, the client holds its
 * decoded mirror, and they are different types that happen to share this one
 * field. `dead` returns the healthy scale because a dead player is not
 * simulated at all (see `GameRoom.update`, which only moves players with
 * queued input, and the client, which stops predicting for a ghost) — giving
 * it its own number would imply a movement rule that does not exist.
 */
export function speedScaleFor(condition: PlayerCondition): number {
  return condition === PLAYER_CONDITION.INJURED ? INJURED_SPEED_MULTIPLIER : 1;
}
