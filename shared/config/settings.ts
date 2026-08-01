import {
  KILL_COOLDOWN_MS,
  DISCUSSION_MS,
  VOTING_MS,
  CONFIRM_EJECTS,
  VOTES_ARE_PUBLIC,
} from "./gameConfig";
import { RANDOM_TASKS_PER_PLAYER } from "./tasks";

/**
 * The balance-tuning registry: every number/toggle the host can adjust from
 * the lobby, as pure data. This is the extensibility contract for tunable
 * settings the same way `shared/config/roles.ts`'s `ROLE_DEFINITIONS` is for
 * roles — adding a setting means adding one entry here (plus, same as
 * today's constants, whatever one line of game logic should start reading it
 * instead of its old hardcoded value); the lobby UI, room persistence and
 * validation all read this generically and need no changes.
 *
 * Colyseus schema wants typed fields, which would defeat "no code changes
 * required" for a new setting — so the room stores every value as a plain
 * string in one `GameState.settings: MapSchema<string>` (the same trick
 * `enabledRoleIds` already uses for roles: one generic collection, validated
 * against this registry, instead of one schema field per entry).
 */

export type SettingType = "number" | "boolean";

export interface SettingDefinition {
  id: string;
  type: SettingType;
  /**
   * UI formatting hint for number settings only: "ms" is stored in
   * milliseconds but shown to the host in whole seconds; "count" is shown
   * as-is. Irrelevant for `type: "boolean"`.
   */
  unit?: "ms" | "count";
  default: number | boolean;
  /** Number settings only, in the raw stored unit (ms or count). */
  min?: number;
  max?: number;
  step?: number;
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    // 0 is a deliberate sentinel meaning "Auto": fall back to the base
    // Stranger role's own per-headcount threshold table (today's exact
    // behavior) instead of forcing a specific count. See
    // `resolveRoleCounts`'s `overrides` parameter.
    id: "strangerCount",
    type: "number",
    unit: "count",
    default: 0,
    min: 0,
    max: 6,
    step: 1,
  },
  {
    id: "killCooldownMs",
    type: "number",
    unit: "ms",
    default: KILL_COOLDOWN_MS,
    min: 10_000,
    max: 90_000,
    step: 5_000,
  },
  {
    id: "discussionMs",
    type: "number",
    unit: "ms",
    default: DISCUSSION_MS,
    min: 10_000,
    max: 180_000,
    step: 5_000,
  },
  {
    id: "votingMs",
    type: "number",
    unit: "ms",
    default: VOTING_MS,
    min: 10_000,
    max: 120_000,
    step: 5_000,
  },
  {
    id: "tasksPerPlayer",
    type: "number",
    unit: "count",
    default: RANDOM_TASKS_PER_PLAYER,
    min: 0,
    max: 10,
    step: 1,
  },
  {
    id: "confirmEjects",
    type: "boolean",
    default: CONFIRM_EJECTS,
  },
  {
    // Whether players can vote to mute someone for the rest of the round.
    // On by default: the alternative in a room with a spammer is that
    // everyone else leaves. Host-disablable for private games among friends,
    // where the feature is only ever a prank vector.
    id: "voteMuteEnabled",
    type: "boolean",
    default: true,
  },
  {
    // Whether players choose their own role from a private hand after
    // factions are dealt, instead of simply being handed one. Off falls back
    // to the exact random assignment that predates selection — the phase is
    // skipped, not merely auto-picked, so a lobby that doesn't want the extra
    // 20 seconds pays nothing for it.
    //
    // Public, like every other setting: which is fine, and in fact required.
    // Whether selection is running is something the whole room can already
    // see (there is a phase for it); what stays secret is only ever what any
    // individual was offered and took.
    id: "roleSelectionEnabled",
    type: "boolean",
    default: true,
  },
  {
    // Whether the results screen names who voted for whom. Off (the default)
    // is what `VOTES_ARE_PUBLIC` used to hardcode for every room; this makes
    // it a real per-lobby choice instead, the same move `confirmEjects`
    // already made for `CONFIRM_EJECTS`.
    //
    // While the ballot is open this changes NOTHING about the wire: an
    // individual vote is never broadcast either way, public or anonymous —
    // see `GameRoom.resolveVotes`, which is the one place ballots become
    // tallies and the only place this setting is read. Anonymity is a
    // disclosure decision made once, at resolution; it is not a reason for a
    // vote to ever leave the server mid-ballot.
    id: "votesArePublic",
    type: "boolean",
    default: VOTES_ARE_PUBLIC,
  },
] as const;

const SETTINGS_BY_ID = new Map(SETTING_DEFINITIONS.map((s) => [s.id, s]));

export function settingById(id: string): SettingDefinition | undefined {
  return SETTINGS_BY_ID.get(id);
}

/** The wire form of a setting's value — always a plain string in `GameState.settings`. */
export function serializeSettingValue(value: number | boolean): string {
  return String(value);
}

/**
 * Parse a stored string back into its typed value, per the definition's
 * `type`. Falls back to the definition's own default on anything
 * unparseable (a value should never actually get this malformed — writes go
 * through `coerceSettingValue` — but a reader must never throw over it).
 */
export function parseSettingValue(
  definition: SettingDefinition,
  raw: string | undefined,
): number | boolean {
  if (raw === undefined) {
    return definition.default;
  }
  if (definition.type === "boolean") {
    return raw === "true";
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : (definition.default as number);
}

/**
 * Validate and clamp a client-supplied candidate value against its
 * definition. Returns `null` when the type itself is wrong (a string sent
 * for a boolean setting, say) — the caller rejects the whole request in that
 * case, same as any other malformed input. An out-of-range *number*, in
 * contrast, is clamped rather than rejected: a slightly-too-high request is a
 * usable request, not an attack.
 */
export function coerceSettingValue(
  definition: SettingDefinition,
  raw: unknown,
): number | boolean | null {
  if (definition.type === "boolean") {
    return typeof raw === "boolean" ? raw : null;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  let value = raw;
  if (definition.min !== undefined) {
    value = Math.max(definition.min, value);
  }
  if (definition.max !== undefined) {
    value = Math.min(definition.max, value);
  }
  return value;
}
