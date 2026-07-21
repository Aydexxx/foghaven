import {
  KILL_COOLDOWN_MS,
  SABOTAGE_COOLDOWN_MS,
  ADVANCED_SABOTAGE_COOLDOWN_MS,
  DOOR_LOCK_COOLDOWN_MS,
  TUNNEL_COOLDOWN_MS,
  SHAPESHIFT_COOLDOWN_MS,
  SILENCE_COOLDOWN_MS,
  COMMS_SABOTAGE_COOLDOWN_MS,
  CRITICAL_SABOTAGE_COOLDOWN_MS,
} from "./gameConfig";

/**
 * Which game phase an ability may be used in. Defaults to `"playing"` when a
 * `RoleDefinition` omits it — only Alderman and Constable act during a
 * meeting instead of open play.
 */
export type AbilityPhase = "playing" | "meeting";

/**
 * How the CLIENT should gather a target for an ability button — a UX hint
 * only; the server never trusts it and re-derives everything itself. Kept
 * here, next to the definition it describes, rather than duplicated per
 * component.
 *
 *   - "player": nearest living other player in range (kill, execute_shot)
 *   - "body":   nearest reportable body in range (investigate)
 *   - "room":   the room the local player currently stands in (place_camera)
 *   - "none":   no target needed (light_lamp, commune, double_vote)
 */
export type AbilityTargetKind = "player" | "body" | "room" | "none";

/**
 * The role registry: every role the game knows, as pure data. This file is
 * the extensibility contract — adding a role to the game means adding one
 * entry here plus one ability file on the server (`server/src/abilities/`),
 * and nothing else. Game logic never names a concrete role; it asks a role's
 * *definition* for its faction, ability, cooldown and uses, so a new entry
 * flows through distribution, win conditions, the task bar, the reveal
 * screen and the ability button without any of them changing.
 *
 * Shared between client and server on purpose, and safe to be: everything
 * here is rules, not state. Which roles EXIST (and which are enabled — see
 * `GameState.enabledRoleIds`) is public knowledge every player needs to
 * render the lobby and compute the stranger tally. Who HOLDS each role is
 * the secret, and that never leaves the server's private `roles` map except
 * over each player's own private message.
 */

export const FACTION = {
  TOWNSFOLK: "townsfolk",
  STRANGER: "stranger",
  NEUTRAL: "neutral",
} as const;

export type Faction = (typeof FACTION)[keyof typeof FACTION];

/**
 * One ability a role can use, by registry id, with its own cadence. A role's
 * `abilities` array holds one of these per ability it has — most roles have
 * exactly one, a few (Stranger, Saboteur) have several, and some (Villager,
 * Decoy) have none. Each slot is independent: two abilities on the same role
 * never share a cooldown or a use count.
 */
export interface AbilitySlot {
  /** Registry id of the ability implementation, e.g. `"kill"`, `"sabotage"`. */
  ability: string;
  /** Time between ability uses. 0 means no cooldown beyond the initial delay. */
  cooldownMs: number;
  /** Total ability uses per game. `Infinity` = unlimited. Never serialized. */
  uses: number;
  /**
   * When true, `uses` resets to its full value at every meeting boundary
   * (alongside the existing cooldown re-arm) instead of being a lifetime
   * game-total. "1 per round" abilities (Detective, Watchman, Medium) set
   * this; "once per game" abilities (Lamplighter, Alderman, Constable)
   * leave it unset.
   */
  usesPerRound?: boolean;
  /** Which phase this ability is usable in. Defaults to `"playing"`. */
  usablePhase?: AbilityPhase;
  /** How the client should gather a target for this ability. Defaults to `"player"`. */
  abilityTargetKind?: AbilityTargetKind;
}

export interface RoleDefinition {
  id: string;
  faction: Faction;
  /** Every ability this role has, by registry id. Empty for roles with no ability. */
  abilities: readonly AbilitySlot[];
  /** Part of the default (Classic) role set. */
  enabled: boolean;
  /** Part of the minimal (Pure) role set — the two roles the game began with. */
  core: boolean;
  /**
   * The fill role receives every seat not claimed by another role's
   * distribution. Exactly one role must have this.
   */
  fill?: boolean;
  /**
   * Whether holders of this role are told the names of the other members of
   * their faction. True only where mutual knowledge is part of the design
   * (strangers conspire); a townsfolk-faction role must never learn who its
   * "fellows" are, since scattering that knowledge is what the game is about.
   */
  revealsFellows: boolean;
  /**
   * How many of this role a lobby gets, as `[minPlayers, count]` pairs
   * ordered from the largest lobby down — the first entry whose threshold
   * the lobby meets wins; no entry met means zero. Ignored for the fill role.
   */
  thresholds: ReadonlyArray<readonly [number, number]>;
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    // The base role: no ability, and every seat no other enabled role
    // claimed. Keeping its ratio high (it only ever gets the *remainder*
    // seats) is what keeps a Chaos lobby readable rather than a wall of
    // specialists.
    id: "villager",
    faction: FACTION.TOWNSFOLK,
    abilities: [],
    enabled: true,
    core: true,
    fill: true,
    revealsFellows: false,
    thresholds: [],
  },
  {
    id: "stranger",
    faction: FACTION.STRANGER,
    abilities: [
      { ability: "kill", cooldownMs: KILL_COOLDOWN_MS, uses: Infinity },
      {
        ability: "sabotage",
        cooldownMs: SABOTAGE_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "none",
      },
      {
        ability: "tunnel",
        cooldownMs: TUNNEL_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "none",
      },
    ],
    enabled: true,
    core: true,
    revealsFellows: true,
    // 10+ players → 3, 7-9 → 2, anything smaller → 1.
    thresholds: [
      [10, 3],
      [7, 2],
      [0, 1],
    ],
  },
  {
    // The proof the registry works: a role added after the rebuild, defined
    // entirely by this entry plus `server/src/abilities/protect.ts`. Not in
    // the default set — Chaos (or a host toggle) opts a lobby in.
    id: "doctor",
    faction: FACTION.TOWNSFOLK,
    abilities: [{ ability: "protect", cooldownMs: 0, uses: 1, abilityTargetKind: "player" }],
    enabled: false,
    core: false,
    revealsFellows: false,
    thresholds: [[5, 1]],
  },
  {
    // Produces information: a circumstantial witness, not a confirmed read
    // on the killer — see `server/src/abilities/investigate.ts`.
    id: "detective",
    faction: FACTION.TOWNSFOLK,
    abilities: [
      {
        ability: "investigate",
        cooldownMs: 0,
        uses: 1,
        usesPerRound: true,
        abilityTargetKind: "body",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: false,
    thresholds: [[6, 1]],
  },
  {
    // Produces information: temporarily lifts the fog for everyone — the
    // one ability that reaches directly into the visibility rule itself.
    id: "lamplighter",
    faction: FACTION.TOWNSFOLK,
    abilities: [
      { ability: "light_lamp", cooldownMs: 20_000, uses: 2, abilityTargetKind: "none" },
    ],
    enabled: false,
    core: false,
    revealsFellows: false,
    thresholds: [[6, 1]],
  },
  {
    // Produces information: who passed through a chosen room before the
    // next meeting, unless a sabotage blinds the feed.
    id: "watchman",
    faction: FACTION.TOWNSFOLK,
    abilities: [
      {
        ability: "place_camera",
        cooldownMs: 0,
        uses: 1,
        usesPerRound: true,
        abilityTargetKind: "room",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: false,
    thresholds: [[7, 1]],
  },
  {
    // Produces information: one automatic factual clue about a dead player,
    // never a live channel to them — the living/dead wall stays intact.
    id: "medium",
    faction: FACTION.TOWNSFOLK,
    abilities: [
      { ability: "commune", cooldownMs: 0, uses: 1, usesPerRound: true, abilityTargetKind: "none" },
    ],
    enabled: false,
    core: false,
    revealsFellows: false,
    thresholds: [[7, 1]],
  },
  {
    // Applies social pressure: one vote that counts double, once per game.
    id: "alderman",
    faction: FACTION.TOWNSFOLK,
    abilities: [
      {
        ability: "double_vote",
        cooldownMs: 0,
        uses: 1,
        usablePhase: "meeting",
        abilityTargetKind: "none",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: false,
    thresholds: [[8, 1]],
  },
  {
    // Disproves information / applies social pressure: a public execution
    // during a meeting — high reward against a Stranger, mutual death
    // against anyone else.
    id: "constable",
    faction: FACTION.TOWNSFOLK,
    abilities: [
      {
        ability: "execute_shot",
        cooldownMs: 0,
        uses: 1,
        usablePhase: "meeting",
        abilityTargetKind: "player",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: false,
    thresholds: [[9, 1]],
  },
  {
    // Destroys visual evidence: briefly takes another player's name and
    // color, so a live observer's report of "who I just saw" goes stale the
    // moment the disguise drops.
    id: "shapeshifter",
    faction: FACTION.STRANGER,
    abilities: [
      {
        ability: "shapeshift",
        cooldownMs: SHAPESHIFT_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "player",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: true,
    // Deliberately above every townsfolk specialist's threshold (5-9): these
    // six roles are all Stranger-faction, and the fewer other stranger sub-
    // roles are competing for the shared stranger-seat cap (see
    // `resolveRoleCounts`'s clamp), the more predictable a bigger lobby's
    // deal stays. Spaced out here the same way the townsfolk specialists are.
    thresholds: [[11, 1]],
  },
  {
    // The town's true sabotage role: a stronger fog than the base Stranger's,
    // locking a room's doors, cutting comms (task list + room labels), and —
    // the big one — a critical failure that starts a repair-or-lose
    // countdown. Each is its own ability with its own cooldown; using one
    // never blocks another, except the critical failure itself locks out
    // every other sabotage type until it resolves (see each ability file's
    // own `criticalSabotageActive` check).
    id: "saboteur",
    faction: FACTION.STRANGER,
    abilities: [
      {
        ability: "advanced_sabotage",
        cooldownMs: ADVANCED_SABOTAGE_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "none",
      },
      {
        ability: "lock_door",
        cooldownMs: DOOR_LOCK_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "room",
      },
      {
        ability: "comms",
        cooldownMs: COMMS_SABOTAGE_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "none",
      },
      {
        ability: "critical_sabotage",
        cooldownMs: CRITICAL_SABOTAGE_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "none",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: true,
    thresholds: [[13, 1]],
  },
  {
    // Disproves information / applies social pressure: guesses a player's
    // exact role during a meeting. Right, and the target dies on the spot;
    // wrong, and the assassin is the one who gets thrown out.
    id: "assassin",
    faction: FACTION.STRANGER,
    abilities: [
      {
        ability: "assassinate",
        cooldownMs: 0,
        uses: 1,
        usablePhase: "meeting",
        abilityTargetKind: "player",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: true,
    thresholds: [[14, 1]],
  },
  {
    // Applies social pressure: gags a player's meeting chat one meeting from
    // now, forcing them to make their case through someone else or not at
    // all.
    id: "silencer",
    faction: FACTION.STRANGER,
    abilities: [
      {
        ability: "silence",
        cooldownMs: SILENCE_COOLDOWN_MS,
        uses: Infinity,
        abilityTargetKind: "player",
      },
    ],
    enabled: false,
    core: false,
    revealsFellows: true,
    thresholds: [[12, 1]],
  },
  {
    // No ability at all — the Decoy's whole trick is passive. See
    // `findWitness`'s Decoy override: a Decoy witness always reads as
    // townsfolk to the Detective, regardless of their real faction.
    id: "decoy",
    faction: FACTION.STRANGER,
    abilities: [],
    enabled: false,
    core: false,
    revealsFellows: true,
    thresholds: [[10, 1]],
  },
] as const;

/** Role id constants. Values are wire/config identifiers, not display names. */
export const ROLES = {
  VILLAGER: "villager",
  STRANGER: "stranger",
  DOCTOR: "doctor",
  DETECTIVE: "detective",
  LAMPLIGHTER: "lamplighter",
  WATCHMAN: "watchman",
  MEDIUM: "medium",
  ALDERMAN: "alderman",
  CONSTABLE: "constable",
  SHAPESHIFTER: "shapeshifter",
  SABOTEUR: "saboteur",
  ASSASSIN: "assassin",
  SILENCER: "silencer",
  DECOY: "decoy",
} as const;

/**
 * A role id. Deliberately `string` rather than a closed union: the whole
 * point of the registry is that new ids appear without type-level ripple.
 */
export type Role = string;

export const PRESET = {
  CLASSIC: "classic",
  CHAOS: "chaos",
  PURE: "pure",
} as const;

export type Preset = (typeof PRESET)[keyof typeof PRESET];

/**
 * A host toggling individual roles away from any preset's exact set is
 * reported as this pseudo-preset in `GameState.rolePreset`.
 */
export const PRESET_CUSTOM = "custom";

/**
 * The role ids a preset enables. Pure = the core pair the game began with;
 * Classic = the curated default set (`enabled`); Chaos = everything the
 * registry knows.
 */
export function presetRoleIds(preset: Preset): string[] {
  switch (preset) {
    case PRESET.PURE:
      return ROLE_DEFINITIONS.filter((role) => role.core).map((role) => role.id);
    case PRESET.CHAOS:
      return ROLE_DEFINITIONS.map((role) => role.id);
    case PRESET.CLASSIC:
      return ROLE_DEFINITIONS.filter((role) => role.enabled).map((role) => role.id);
  }
}

const ROLES_BY_ID = new Map(ROLE_DEFINITIONS.map((role) => [role.id, role]));

export function roleById(id: string): RoleDefinition | undefined {
  return ROLES_BY_ID.get(id);
}

/**
 * The faction a role id belongs to. Throws on an unknown id on purpose —
 * every caller passes ids that came from the registry itself (via the
 * server's roles map or the public settings list), so an unknown id is a
 * config bug that should be loud, not a case to shrug at.
 */
export function factionOf(roleId: string): Faction {
  const role = ROLES_BY_ID.get(roleId);
  if (!role) {
    throw new Error(`Unknown role id "${roleId}"`);
  }
  return role.faction;
}

/** The single fill role (the seats-remainder role — townsfolk). */
export function fillRole(): RoleDefinition {
  const role = ROLE_DEFINITIONS.find((definition) => definition.fill);
  if (!role) {
    throw new Error("Role registry has no fill role");
  }
  return role;
}
