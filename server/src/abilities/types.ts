import type { Faction, RoomSlug, Vec2 } from "@foghaven/shared";
import type { Body, Player } from "../rooms/schema/GameState";

/**
 * The contract every role ability implements — the other half of the
 * extensibility story alongside `shared/config/roles.ts`: a new role is one
 * registry entry there plus one file here, registered in `index.ts`.
 *
 * The generic gates (game phase, actor alive, cooldown elapsed, uses
 * remaining) are checked by `GameRoom.handleAbility` BEFORE `execute` runs;
 * an ability only implements what is specific to it — its target rules and
 * its effect. Target validity deliberately lives here rather than in the
 * generic handler, because "a valid target" means different things per
 * ability (some abilities target a player, others a body, a room, or
 * nothing at all — see `AbilityTargetKind` in the shared registry).
 */
export interface Ability {
  id: string;
  /**
   * Validate and perform. Return true if the ability fired — which is what
   * consumes a use and starts the cooldown — or false to reject silently
   * (the same "a rejected attempt costs nothing and answers nothing" rule
   * every other handler in `GameRoom` follows).
   */
  execute(ctx: AbilityContext): boolean;
}

/**
 * The narrow slice of the room an ability may touch. Kept deliberately
 * small: an ability that needs more than this is a sign its effect belongs
 * in the room as a primitive (the way `kill()` is), not that the facade
 * should widen.
 */
export interface AbilityContext {
  actorId: string;
  /** Sanitized target session id from the client message, if one was sent. */
  targetId?: string;
  actor: Player;
  /** The target's player, when `targetId` names someone in the room. */
  target?: Player;
  /** The target's body, when `targetId` names one in `state.bodies` (Detective). */
  targetBody?: Body;
  /** The room slug from the client message, validated against real placeable rooms (Watchman). */
  targetRoom?: RoomSlug;
  /** The meeting sub-stage right now — `""` outside a meeting (Alderman, Constable). */
  meetingStage: string;
  /** The faction of a session's secret role, or undefined for no seat. */
  factionOf(sessionId: string): Faction | undefined;
  /**
   * The exact role id of a session's secret role, or undefined for no seat.
   * Only needed where a faction isn't specific enough — the Assassin's exact
   * guess, and the Detective's Decoy override.
   */
  roleIdOf(sessionId: string): string | undefined;
  /** A role guess from the client message, if one was sent (Assassin). */
  guessedRole?: string;
  withinRange(a: Vec2, b: Vec2, range: number): boolean;
  /** Line-of-sight — walls stop abilities the way they stop sight. */
  canSee(a: Vec2, b: Vec2): boolean;
  /** Kill a player: body, victim notification, win check. */
  kill(victim: Player): void;
  /** Private message to the acting player only. */
  sendToActor(type: string, payload?: unknown): void;
  /**
   * One factual clue about a dead player this medium hasn't heard yet, or
   * null once the pool is exhausted for this game. See `GameRoom`'s
   * `deathLocations` / `mediumRevealed` maps for what backs this.
   */
  communeWithDead(): { name: string; room: RoomSlug; killerFaction: Faction | null } | null;
  /**
   * One random session recently seen in `room`, excluding `excludeIds` — the
   * detective's circumstantial witness. `apparentFaction` is the witness's
   * real faction, except a Decoy witness always reads as townsfolk. See
   * `GameRoom`'s `roomPresence` map.
   */
  findWitness(
    room: RoomSlug,
    excludeIds: string[],
  ): { name: string; apparentFaction: Faction } | null;
  /** Light the lamp: every player becomes visible to every other living player for `durationMs`. */
  litLamp(durationMs: number): void;
  /** Start (or extend) a sabotage: darkens the whole town's vision for `durationMs`. */
  triggerSabotage(durationMs: number): void;
  /** Lock a room's doors for `durationMs` — see `applyInputWithLocks`. */
  lockDoor(room: RoomSlug, durationMs: number): void;
  /** Teleport the actor directly to `pos` and broadcast an audible tunnel sound at both ends. */
  teleportActor(pos: Vec2, otherEnd: Vec2): void;
  /** Take on `targetId`'s name and appearance for `durationMs` (Shapeshifter). */
  disguiseAs(targetId: string, durationMs: number): void;
  /** Gag `targetId`'s chat for the next meeting that starts (Silencer). */
  pendingSilence(targetId: string): void;
  /** Eject the acting player through the same public path a vote-eject uses (Assassin, wrong guess). */
  ejectSelf(): void;
  /**
   * Whether a critical sabotage is currently counting down. Every other
   * sabotage-family ability (`sabotage`, `advanced_sabotage`, `lock_door`,
   * `comms`) self-gates on this — none of them fire while the critical
   * failure has the town's full attention.
   */
  criticalSabotageActive: boolean;
  /** Black out the task list and room labels for `durationMs` (Saboteur's comms sabotage). */
  triggerComms(durationMs: number): void;
  /**
   * Start the critical sabotage countdown: `durationMs` to repair both
   * `CRITICAL_REPAIR_POINTS` or the Strangers win outright. Returns false
   * (and fires nothing) if one is already running.
   */
  triggerCriticalSabotage(durationMs: number): boolean;
  /**
   * Cross-ability state for the current round of play. Cleared whenever a
   * meeting starts, the game ends, or the room returns to the lobby — an
   * effect stored here expires at the next meeting for free.
   */
  roundStore: Map<string, unknown>;
}

const PROTECTED_KEY = "protectedIds";

/**
 * The set of session ids currently shielded from a kill — written by
 * `protect`, consumed by `kill`. Lives in the round store (not on either
 * ability) because it is shared state between two abilities, and in this
 * neutral module so neither ability file imports the other.
 */
export function protectedIds(roundStore: Map<string, unknown>): Set<string> {
  let ids = roundStore.get(PROTECTED_KEY) as Set<string> | undefined;
  if (!ids) {
    ids = new Set<string>();
    roundStore.set(PROTECTED_KEY, ids);
  }
  return ids;
}

export interface CameraRecord {
  roomSlug: RoomSlug;
  sightings: Set<string>;
  blinded: boolean;
}

const CAMERAS_KEY = "cameras";

/**
 * Active watchman cameras for the current round, keyed by owner session id.
 * Written by `place_camera`, populated tick-by-tick by `GameRoom.update()`,
 * read and cleared at the next `startMeeting`.
 */
export function cameras(roundStore: Map<string, unknown>): Map<string, CameraRecord> {
  let map = roundStore.get(CAMERAS_KEY) as Map<string, CameraRecord> | undefined;
  if (!map) {
    map = new Map<string, CameraRecord>();
    roundStore.set(CAMERAS_KEY, map);
  }
  return map;
}

const VOTE_WEIGHTS_KEY = "voteWeights";

/**
 * Per-voter ballot weight for the current meeting, keyed by voter session
 * id. Written by `double_vote`; `GameRoom.resolveVotes` reads this instead
 * of assuming every ballot counts as 1.
 */
export function voteWeights(roundStore: Map<string, unknown>): Map<string, number> {
  let map = roundStore.get(VOTE_WEIGHTS_KEY) as Map<string, number> | undefined;
  if (!map) {
    map = new Map<string, number>();
    roundStore.set(VOTE_WEIGHTS_KEY, map);
  }
  return map;
}
