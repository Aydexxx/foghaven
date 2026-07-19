import { PLAYER_SPEED, PLAYER_RADIUS, MAP } from "../config/gameConfig";

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
 * Advance a position by one input command. Diagonals are normalised so movement
 * speed is constant in every direction, and the result is clamped to the map so
 * the player circle stays fully inside the play area. Server and client both
 * call this with the same `SIM_DT`, which is what keeps prediction in lockstep
 * with the authoritative simulation.
 */
export function applyInput(pos: Vec2, dir: Direction, dt: number): Vec2 {
  let dx = dir.x;
  let dy = dir.y;

  const length = Math.hypot(dx, dy);
  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  return {
    x: clamp(pos.x + dx * PLAYER_SPEED * dt, PLAYER_RADIUS, MAP.width - PLAYER_RADIUS),
    y: clamp(pos.y + dy * PLAYER_SPEED * dt, PLAYER_RADIUS, MAP.height - PLAYER_RADIUS),
  };
}
