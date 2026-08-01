import {
  FACTION,
  ROLE_DEFINITIONS,
  fillRole,
  roleById,
  type Faction,
} from "../config/roles";
import { MAX_ROLE_OPTIONS, MIN_ROLE_OPTIONS } from "../config/gameConfig";
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
 * The distinct role ids a faction's deal actually contains, in registry
 * order — the pool a player of that faction can be offered a choice from.
 * Derived from `resolveRoleCounts`, so it counts only roles that genuinely
 * have a seat in THIS deal (a role enabled but clamped to zero seats is not
 * offerable, because nobody could receive it).
 */
export function factionRolePool(
  faction: Faction,
  playerCount: number,
  enabledRoleIds: readonly string[],
  overrides: Readonly<Record<string, number>> = {},
): string[] {
  const counts = resolveRoleCounts(playerCount, enabledRoleIds, overrides);
  return ROLE_DEFINITIONS.filter(
    (role) => role.faction === faction && (counts[role.id] ?? 0) > 0,
  ).map((role) => role.id);
}

/**
 * How many real role cards every player is offered this game (the Random
 * card is always additional). Returns 0 when selection should be skipped
 * entirely and roles dealt at random, as they were before selection existed.
 *
 * ## Why this is one number for the whole room
 *
 * This is the load-bearing security property of role selection, so it is
 * worth being explicit about.
 *
 * The set of roles a player is offered is drawn from their own faction's
 * pool. If the count of that offer varied by faction — say strangers can
 * only ever be shown 2 cards because their pool is small, while townsfolk
 * see 3 — then the card count IS the player's faction, handed to their own
 * client. Worse, a smaller pool is quicker to choose from, so "who finished
 * first" becomes a statistical faction tell to the entire room, which no
 * amount of care about *what* the server sends could undo.
 *
 * So the count is the minimum across every faction's pool, capped at
 * `MAX_ROLE_OPTIONS` — one number, applied to everyone. Crucially it is a
 * pure function of *public* inputs only (roster size, the public
 * `enabledRoleIds`, and the public balance overrides), exactly like
 * `strangerFactionCount` above: every client can compute it independently,
 * so knowing it conveys nothing that was not already on the wire.
 *
 * Below `MIN_ROLE_OPTIONS` real cards there is no meaningful choice left, so
 * the phase is skipped rather than degenerating into "take this one role or
 * press Random" — which, being one card, would also be the thinnest possible
 * pool and the fastest possible pick.
 */
export function roleSelectOptionCount(
  playerCount: number,
  enabledRoleIds: readonly string[],
  overrides: Readonly<Record<string, number>> = {},
): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (const faction of Object.values(FACTION)) {
    const pool = factionRolePool(faction, playerCount, enabledRoleIds, overrides);
    // A faction with no seats at all this game (no players will hold it) puts
    // no constraint on the offer size — there is nobody to offer.
    if (pool.length === 0) {
      continue;
    }
    smallest = Math.min(smallest, pool.length);
  }
  if (!Number.isFinite(smallest)) {
    return 0;
  }
  const count = Math.min(MAX_ROLE_OPTIONS, smallest);
  return count >= MIN_ROLE_OPTIONS ? count : 0;
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
 * The wire value for the Random card. Not a role id — deliberately outside
 * the registry's namespace so it can never collide with one, the same
 * reasoning `SKIP_VOTE` follows for the ballot.
 */
export const RANDOM_ROLE_PICK = "__random__";

/**
 * One player's own role options, sent **privately to that one client** and
 * to nobody else — see `GameRoom.beginRoleSelect`.
 *
 * This message is the entire attack surface of role selection. Everything a
 * modified client could learn about anyone else's faction lives or dies on
 * this being per-socket: `options` is drawn from the recipient's own faction
 * pool, so a single leaked payload is a full faction reveal for that player.
 * It is therefore deliberately NOT part of `GameState` — nothing here may
 * ever be moved into schema, however convenient, because schema is broadcast
 * (filters gate *changes*, they are not a secrecy primitive; see the note on
 * `GameState.players`).
 *
 * `options.length` is the same for every player in the room by construction
 * (`roleSelectOptionCount`) and is computable from public state, so the size
 * of this list is not itself a signal.
 *
 * `deadlineMs` is a duration from receipt, not a timestamp — same reason as
 * `AbilityStateMessage.cooldownMs`: client and server clocks aren't in sync.
 */
export interface RoleOptionsMessage {
  options: string[];
  deadlineMs: number;
}

/** A player's choice: one of their own offered role ids, or `RANDOM_ROLE_PICK`. */
export interface PickRoleMessage {
  roleId: string;
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
