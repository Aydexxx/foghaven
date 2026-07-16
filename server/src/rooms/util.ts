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

/** The world bounds new players spawn within, in world units. */
export const SPAWN_BOUNDS = { width: 800, height: 600 } as const;

/** A random spawn position within the world bounds. */
export function randomSpawn(): { x: number; y: number } {
  return {
    x: Math.floor(Math.random() * SPAWN_BOUNDS.width),
    y: Math.floor(Math.random() * SPAWN_BOUNDS.height),
  };
}
