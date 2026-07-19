/**
 * The secret roles a player can hold.
 *
 * These values exist on the client only so it can render the role the server
 * privately told *it*. A role is never part of the public room state — see
 * `Player` in the server schema for why.
 */
export const ROLES = {
  TOWNSFOLK: "townsfolk",
  STRANGER: "stranger",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** How long the secret role reveal is shown before the world opens up. */
export const ROLE_REVEAL_MS = 4000;

export const TIMERS = {
  roleRevealMs: ROLE_REVEAL_MS,
} as const;

/** Authoritative server simulation rate (ticks per second). */
export const TICK_RATE = 20;

/**
 * How many input commands the client samples and sends per second. Each command
 * represents exactly `SIM_DT` seconds of movement, so client prediction and
 * server simulation advance by the same amount regardless of frame or tick
 * timing — this is what makes reconciliation exact.
 */
export const INPUT_RATE = 30;

/** Seconds of movement represented by a single input command. */
export const SIM_DT = 1 / INPUT_RATE;

/** Player movement speed, in world units per second. */
export const PLAYER_SPEED = 220;

/** Player radius in world units (used for rendering and bounds clamping). */
export const PLAYER_RADIUS = 16;

/** The rectangular play area, in world units. */
export const MAP = { width: 800, height: 600 } as const;

/** Minimum number of players required before the host can start the game. */
export const MIN_PLAYERS = 4;

/**
 * How many strangers a game gets, as `[minPlayers, strangers]` pairs ordered
 * from the largest lobby down. The first entry whose threshold the lobby meets
 * wins, so the table reads: 10+ → 3, 7-9 → 2, anything smaller → 1.
 */
export const STRANGER_THRESHOLDS = [
  [10, 3],
  [7, 2],
  [0, 1],
] as const;

/**
 * Room lifecycle phases. Shared between client and server so both sides
 * compare against the same literal instead of duplicating magic strings.
 */
export const PHASE = {
  LOBBY: "lobby",
  ROLE_REVEAL: "role_reveal",
  PLAYING: "playing",
} as const;

export type Phase = (typeof PHASE)[keyof typeof PHASE];

export const GAME_CONFIG = {
  roles: ROLES,
  timers: TIMERS,
  tickRate: TICK_RATE,
  inputRate: INPUT_RATE,
  simDt: SIM_DT,
  playerSpeed: PLAYER_SPEED,
  playerRadius: PLAYER_RADIUS,
  map: MAP,
  minPlayers: MIN_PLAYERS,
  strangerThresholds: STRANGER_THRESHOLDS,
} as const;
