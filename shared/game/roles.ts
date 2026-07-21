import {
  FACTION,
  ROLE_DEFINITIONS,
  fillRole,
  roleById,
  type Faction,
} from "../config/roles";
import type { Vec2 } from "./movement";

/**
 * Role distribution: how many seats each enabled role gets in a lobby of a
 * given size. Shared for the same reason `movement.ts` and `vision.ts` are:
 * the server deals from this and the client's reveal screen shows its tally
 * from this, both as the same pure function of *public* inputs (roster size
 * plus the public `enabledRoleIds` settings) — so what is displayed and what
 * is dealt can never disagree, and neither reveals anything about who drew
 * which seat.
 */

/**
 * Seats per role id. Every enabled non-fill role takes its threshold count
 * (in registry order), subject to two invariant clamps; the fill role takes
 * the remainder.
 *
 * The clamps guard against degenerate *configurations*, not cheating:
 *  - stranger-faction seats are clamped to `floor((n-1)/2)` (but never below
 *    1 when any stranger role is enabled) so no game can begin at or past
 *    parity — win checks are event-driven, so an instant-parity deal would
 *    not end the game at start, it would hand strangers a nonsense win on
 *    the first event;
 *  - non-fill seats in total are clamped to the player count, trimming
 *    non-stranger specials first (in reverse registry order), so the fill
 *    role's remainder can never go negative.
 *
 * `overrides` lets the host's balance settings (see `shared/config/settings.ts`,
 * e.g. a forced `strangerCount`) replace a role's threshold-table count for
 * this deal — the clamps above still run on top of an override exactly as
 * they would on the table's own number, so a host cranking a count up
 * unreasonably high for a small lobby is still capped, never let past parity.
 */
export function resolveRoleCounts(
  playerCount: number,
  enabledRoleIds: readonly string[],
  overrides: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const enabled = new Set(enabledRoleIds);
  const fill = fillRole();

  const counts: Record<string, number> = {};
  for (const role of ROLE_DEFINITIONS) {
    if (role.fill || !enabled.has(role.id)) {
      continue;
    }
    counts[role.id] = overrides[role.id] ?? thresholdCount(role.thresholds, playerCount);
  }

  // Clamp 1: stranger faction stays strictly below half the lobby.
  const strangerCap = Math.max(1, Math.floor((playerCount - 1) / 2));
  let strangerTotal = 0;
  for (const role of ROLE_DEFINITIONS) {
    if (role.faction !== FACTION.STRANGER || !(role.id in counts)) {
      continue;
    }
    const take = Math.min(counts[role.id]!, strangerCap - strangerTotal);
    counts[role.id] = Math.max(0, take);
    strangerTotal += counts[role.id]!;
  }

  // Clamp 2: specials in total never exceed the lobby; trim non-stranger
  // specials first so the stranger presence (the game's engine) survives.
  let specialTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (specialTotal > playerCount) {
    for (const role of [...ROLE_DEFINITIONS].reverse()) {
      if (specialTotal <= playerCount) {
        break;
      }
      if (role.faction === FACTION.STRANGER || !(role.id in counts)) {
        continue;
      }
      const trim = Math.min(counts[role.id]!, specialTotal - playerCount);
      counts[role.id]! -= trim;
      specialTotal -= trim;
    }
  }

  counts[fill.id] = Math.max(0, playerCount - specialTotal);
  return counts;
}

function thresholdCount(
  thresholds: ReadonlyArray<readonly [number, number]>,
  playerCount: number,
): number {
  for (const [minPlayers, count] of thresholds) {
    if (playerCount >= minPlayers) {
      return count;
    }
  }
  return 0;
}

/**
 * How many stranger-faction seats a lobby deals. A *public* number — every
 * client can compute it from the roster size and the public role settings
 * (plus the public balance settings, via `overrides`), so showing "2
 * strangers hide among you" reveals nothing about who.
 */
export function strangerFactionCount(
  playerCount: number,
  enabledRoleIds: readonly string[],
  overrides: Readonly<Record<string, number>> = {},
): number {
  const counts = resolveRoleCounts(playerCount, enabledRoleIds, overrides);
  let total = 0;
  for (const [roleId, count] of Object.entries(counts)) {
    if (roleById(roleId)?.faction === FACTION.STRANGER) {
      total += count;
    }
  }
  return total;
}

/**
 * The payload the server sends privately to a single client. `fellows` is
 * populated only for roles whose definition has `revealsFellows` (strangers
 * know each other); everyone else always receives an empty list, so their
 * socket never carries another player's identity.
 */
export interface RoleAssignment {
  role: string;
  fellows: string[];
}

/**
 * Sent privately to a player whose role has an ability, whenever their
 * ability availability changes. `cooldownMs` is a duration rather than a
 * deadline on purpose — client and server clocks are not in sync, so the
 * client counts it down locally for the UI. `usesLeft` is null for
 * unlimited (Infinity does not survive serialization). The server
 * re-validates both on every attempt regardless.
 */
export interface AbilityStateMessage {
  /** Which of this role's (possibly several) abilities this update is for. */
  abilityId: string;
  cooldownMs: number;
  usesLeft: number | null;
}

/**
 * The detective's trace — a circumstantial witness, or none found.
 * `apparentFaction` is a soft alignment read on the witness: their real
 * faction, except a Decoy witness always reads as townsfolk.
 */
export interface InvestigateHintMessage {
  witnessName: string | null;
  apparentFaction: Faction | null;
}

/** The medium's automatic clue about a dead player, or null once the pool is exhausted. */
export interface CommuneHintMessage {
  name: string;
  room: string;
  killerFaction: Faction | null;
}

/** A watchman's camera footage, delivered once at the next meeting. */
export interface CameraRevealMessage {
  roomSlug: string;
  names: string[];
  blinded: boolean;
}

/**
 * Private confirmation of an ability's own side effect — today only the
 * doctor's shield placement, so the doctor's own client can draw a faint
 * indicator. Never sent to anyone but the actor; see `protect.ts`'s doc on
 * why that's safe (they already know who they targeted).
 */
export interface AbilityEffectMessage {
  type: string;
  targetId: string;
}

/**
 * Broadcast to every connected client (never fog-filtered) whenever a
 * Stranger uses the cellar tunnel — the "vent equivalent" is never fully
 * invisible. The two points are the tunnel's fixed, already-public
 * endpoints; each client independently decides whether it's close enough to
 * either to actually hear anything, so this reveals only "a sound happened
 * here," never who caused it.
 */
export interface TunnelSoundMessage {
  points: Vec2[];
}

/**
 * Broadcast the instant a critical sabotage (Lighthouse failure/flooding)
 * starts. `durationMs` is a duration, not a deadline — client and server
 * clocks aren't in sync, so each client counts its own local countdown down
 * from receipt, the same reasoning `AbilityStateMessage.cooldownMs` follows.
 */
export interface CriticalSabotageStartedMessage {
  durationMs: number;
}

/** Broadcast once a critical sabotage ends, either way. */
export interface CriticalSabotageResolvedMessage {
  /** True if the town repaired both points in time; false if the clock ran out. */
  repaired: boolean;
}
