import { PLAYER_RADIUS, SPAWN_ZONE, TILE_SIZE } from "@foghaven/shared";

/**
 * Human-readable room code alphabet. Ambiguous glyphs are excluded so codes
 * are easy to read aloud and type: no 0/O, no 1/I/L.
 */
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generate a room code of the given length (default 6) from the safe alphabet. */
export function generateRoomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/**
 * Pick `count` distinct items uniformly at random.
 *
 * Uses a partial Fisher-Yates shuffle on a copy: every subset of the given size
 * is equally likely. (The tempting `sort(() => Math.random() - 0.5)` one-liner
 * is measurably biased, which for role assignment would mean some players draw
 * stranger more often than others.)
 */
export function pickRandom<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const take = Math.max(0, Math.min(count, pool.length));

  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  return pool.slice(0, take);
}

/**
 * A random spawn position in the open plaza. `SPAWN_ZONE` is a sub-rectangle
 * of the Streets chosen (and validated — see the town map) to be entirely
 * open floor, clear of Town Hall's footprint and every door threshold, so
 * every point sampled from it is walkable by construction — no rejection
 * sampling needed, and no chance of a fresh player spawning inside a wall.
 */
export function randomSpawn(): { x: number; y: number } {
  const minX = SPAWN_ZONE.x * TILE_SIZE + PLAYER_RADIUS;
  const maxX = (SPAWN_ZONE.x + SPAWN_ZONE.w) * TILE_SIZE - PLAYER_RADIUS;
  const minY = SPAWN_ZONE.y * TILE_SIZE + PLAYER_RADIUS;
  const maxY = (SPAWN_ZONE.y + SPAWN_ZONE.h) * TILE_SIZE - PLAYER_RADIUS;
  return {
    x: Math.floor(minX + Math.random() * (maxX - minX)),
    y: Math.floor(minY + Math.random() * (maxY - minY)),
  };
}
