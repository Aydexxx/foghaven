import { MAP, PLAYER_RADIUS } from "@foghaven/shared";

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

/** Distinct, visually separable player colours cycled as players join. */
export const PLAYER_COLORS = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#bfef45",
  "#fabed4",
  "#469990",
] as const;

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

/** A random spawn position fully inside the play area (accounting for radius). */
export function randomSpawn(): { x: number; y: number } {
  const minX = PLAYER_RADIUS;
  const maxX = MAP.width - PLAYER_RADIUS;
  const minY = PLAYER_RADIUS;
  const maxY = MAP.height - PLAYER_RADIUS;
  return {
    x: Math.floor(minX + Math.random() * (maxX - minX)),
    y: Math.floor(minY + Math.random() * (maxY - minY)),
  };
}
