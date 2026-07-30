import type { ArraySchema, MapSchema, Schema } from "@colyseus/schema";
import type { LanternState } from "@foghaven/shared";

/**
 * Client-side view of the server's `Player` schema. Extending `Schema` gives
 * us the runtime callback methods colyseus.js attaches to decoded instances
 * (`listen`, `onChange`, ...) without pulling the decorator-based classes into
 * the Vite build. Field names must mirror the server's `Player` schema.
 *
 * There is no `role` here because roles are not public state: the server sends
 * each client its own role over a private message instead. See the `Player`
 * schema on the server.
 */
export interface PlayerState extends Schema {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  /** The §3.5 identity light — one of the 14 `lanternColors`, unique per room, assigned once at join. See the server `Player` schema's own doc. */
  lanternColor: string;
  /** lit / flickering / extinguished / dropped — server-authoritative, never predicted. See `Havener.setLanternState`. */
  lanternState: LanternState;
  alive: boolean;
  /** False while this player is inside their reconnection grace period. */
  connected: boolean;
  hasVoted: boolean;
  lastSeq: number;
  /** The six cosmetic slots — a catalog id or empty string. See the server `Player` schema's own doc. */
  hatId: string;
  accessoryId: string;
  petId: string;
  outfitId: string;
  victoryPoseId: string;
  deathEffectId: string;
}

/** Client-side view of the server's `VoteTally` schema. */
export interface VoteTallyState extends Schema {
  targetId: string;
  targetName: string;
  count: number;
  /** Empty unless votes are configured public. */
  voterNames: string;
}

/** Client-side view of the server's `Body` schema. */
export interface BodyState extends Schema {
  playerId: string;
  name: string;
  x: number;
  y: number;
  color: string;
}

/**
 * Client-side view of the server's `GameState` schema.
 *
 * `players` is filtered per client on the server: a living client's copy
 * simply does not contain dead players, so there is nothing here to hide in
 * the renderer. See the `filterChildren` on the server's `GameState`.
 */
export interface GameState extends Schema {
  players: MapSchema<PlayerState>;
  bodies: MapSchema<BodyState>;
  phase: string;
  hostId: string;
  /**
   * The lobby's role settings — which registry roles this game deals, and
   * the preset they came from. Public game rules, not secrets; see the doc
   * on the server schema for why this doesn't violate role secrecy.
   */
  enabledRoleIds: ArraySchema<string>;
  rolePreset: string;
  /**
   * Balance settings (stranger count, kill cooldown, discussion/voting
   * timers, task count, confirm-ejects), one stringified value per
   * `SETTING_DEFINITIONS` entry — see `net/settings.ts`'s `readRoomSettings`
   * for how these get parsed back into typed values.
   */
  settings: MapSchema<string>;
  meetingReporterId: string;
  meetingBodyId: string;
  meetingBodyName: string;
  /** The room a reported body was found in — see the server schema's own doc. Empty for an emergency meeting. */
  meetingBodyRoom: string;
  meetingIsEmergency: boolean;
  meetingStage: string;
  deadPlayerIds: ArraySchema<string>;
  voteResults: MapSchema<VoteTallyState>;
  ejectedPlayerId: string;
  ejectedPlayerName: string;
  ejectedWasStranger: boolean;
  ejectionConfirmed: boolean;
  taskBarCompleted: number;
  taskBarTotal: number;
  /** Darkens vision town-wide while true — see the server schema's note on this field. */
  sabotageActive: boolean;
  /** Room slugs whose doors are currently locked by a Saboteur — see `applyInputWithLocks`. */
  lockedRoomSlugs: ArraySchema<string>;
  /** Whether the Saboteur's comms sabotage is blacking out the task list and room labels. */
  commsSabotageActive: boolean;
  /** Whether a critical sabotage (Lighthouse failure/flooding) is currently counting down. */
  criticalSabotageActive: boolean;
  /** Which of the two critical repair points have been fixed so far — see `CRITICAL_REPAIR_POINTS`. */
  criticalRepairedPoints: ArraySchema<string>;
  /** Whether the lamplighter's lamp is currently lit — see the fog bypass this drives in `GameScene`. */
  lampLit: boolean;
  winningFaction: string;
  winReason: string;
  /** Every player's name and true role, populated once `phase` is "game_over". */
  finalRoster: MapSchema<RevealedPlayerState>;
}

/** Client-side view of the server's `RevealedPlayer` schema. */
export interface RevealedPlayerState extends Schema {
  id: string;
  name: string;
  role: string;
  color: string;
  hatId: string;
  accessoryId: string;
  petId: string;
  outfitId: string;
  victoryPoseId: string;
  deathEffectId: string;
}
