import {
  LOBBY_SPAWN_ZONE,
  PLAYER_RADIUS,
  SPAWN_ZONE,
  TILE_SIZE,
  type TileRect,
} from "@foghaven/shared";

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
 * A uniform random point inside a tile-rect, inset by the player radius so
 * the sampled point is a legal player *centre* rather than merely a point
 * inside the rectangle. Every rect passed here is validated in the town map
 * as entirely open floor, so this needs no rejection sampling and can never
 * place a player inside a wall.
 */
function randomPointIn(area: TileRect): { x: number; y: number } {
  const minX = area.x * TILE_SIZE + PLAYER_RADIUS;
  const maxX = (area.x + area.w) * TILE_SIZE - PLAYER_RADIUS;
  const minY = area.y * TILE_SIZE + PLAYER_RADIUS;
  const maxY = (area.y + area.h) * TILE_SIZE - PLAYER_RADIUS;
  return {
    x: Math.floor(minX + Math.random() * (maxX - minX)),
    y: Math.floor(minY + Math.random() * (maxY - minY)),
  };
}

/**
 * A random ROUND-START position in the open plaza — where everyone is placed
 * as the round opens, not where they wait beforehand (that's `lobbySpawn`).
 */
export function randomSpawn(): { x: number; y: number } {
  return randomPointIn(SPAWN_ZONE);
}

/**
 * A random waiting position on the Tavern floor — where a lobby arrival
 * appears. Clear of the ready flagstone by construction (see
 * `LOBBY_SPAWN_ZONE`), so joining never counts as readying up.
 */
export function lobbySpawn(): { x: number; y: number } {
  return randomPointIn(LOBBY_SPAWN_ZONE);
}
