import { Schema, MapSchema, ArraySchema, type, filterChildren } from "@colyseus/schema";
import { PHASE, canSee, type LanternState } from "@foghaven/shared";

/**
 * The phases during which the fog restricts what a living client is sent.
 * Outside them — the lobby, a meeting, the game-over screen — everyone is
 * visible to everyone: the lobby is social, a meeting needs every face on
 * the ballot, and the fog guards nothing once the roles are public anyway.
 */
const FOG_PHASES = new Set<string>([PHASE.ROLE_REVEAL, PHASE.PLAYING]);

/**
 * A single connected player. Positions are in world units; the client is
 * free to interpret them however it renders.
 *
 * NOTE: there is deliberately no `role` field here, and one must never be
 * added. Everything in this schema is broadcast to every client in the room,
 * so a role stored here would be readable by anyone inspecting their own
 * network traffic — secrecy would be a client-side illusion. Roles live in a
 * server-only map on `GameRoom` and are delivered per-client over private
 * messages instead.
 *
 * `alive` is public and that is fine: who is dead becomes common knowledge as
 * soon as their body is found, and the living stop receiving dead players
 * entirely (see `GameState.players`).
 */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") color = "";
  @type("boolean") alive = true;

  /**
   * The §3.5 lantern colour this player was dealt — one of the 14
   * `lanternColors`, unique for the room's whole lifetime, assigned once at
   * `GameRoom.onJoin` (`pickLanternColor`) and never reassigned. Distinct
   * from the legacy `color` above: that field still exists only to drive the
   * colour-blind badge and the pre-7.5 preview rig (Inventory/Profile/
   * GameOver), neither of which this touches. This one is the actual
   * identity light the in-world Havener renders (§4.1: "player identity is
   * carried by the lantern, not the body").
   */
  @type("string") lanternColor = "";

  /**
   * lit / flickering / extinguished / dropped — see `LanternState`'s own
   * doc in `shared/game/vision.ts`. Server-authoritative and public for the
   * same reason `alive` is: whether someone doused their lantern is exactly
   * the kind of thing the room can see for itself, so hiding the field
   * would only be a client-side illusion. The CLIENT never predicts or
   * infers this — it renders whatever value arrives here, full stop (see
   * `Havener.setLanternState`).
   */
  @type("string") lanternState: LanternState = "lit";

  /**
   * Whether this player's socket is currently attached. False means they
   * dropped and are inside their reconnection grace period: they keep their
   * seat, their role and their position, and still count toward every win
   * condition — they just aren't there to play it.
   *
   * Public on purpose. Everyone can already see a body standing perfectly
   * still; saying so plainly is better than letting the room mistake a dropped
   * connection for suspicious behaviour.
   */
  @type("boolean") connected = true;

  /**
   * Whether this player has cast their ballot in the current vote. Public on
   * purpose — the "has voted" indicator is part of the meeting UI. *Who* they
   * voted for is not here; that stays in a server-only map until the results
   * are published, and only then if votes are configured public.
   */
  @type("boolean") hasVoted = false;

  /**
   * Sequence number of the last input this player's position reflects. The
   * client uses it to discard acknowledged inputs during reconciliation.
   */
  @type("number") lastSeq = 0;

  /**
   * The six cosmetic slots — a catalog id (see `@foghaven/shared`'s
   * `COSMETICS`) or empty string for "nothing equipped in this slot". Set
   * once at `onJoin` from the account's saved loadout (see
   * `GameRoom.onJoin`'s cosmetics snapshot) and never changed mid-room, the
   * same way `name` is a snapshot of the account rather than something a
   * room message can rewrite.
   *
   * Public on purpose, and safe to be: cosmetics are decorative by
   * construction (the catalog is closed and server-defined — nothing here can
   * ever grant vision, speed, or hitbox advantage), so unlike `role` there is
   * no secrecy this could leak. They ride the exact same `filterChildren`
   * fog gate as `x`/`y`/`name` below simply by being fields on this class —
   * no separate visibility logic needed.
   */
  @type("string") hatId = "";
  @type("string") accessoryId = "";
  @type("string") petId = "";
  @type("string") outfitId = "";
  @type("string") victoryPoseId = "";
  @type("string") deathEffectId = "";
}

/**
 * One candidate's line on the results screen. `voterNames` is left empty
 * unless votes are configured public — the individual ballots are simply not
 * broadcast in the anonymous case.
 */
export class VoteTally extends Schema {
  /** A session id, or `SKIP_VOTE`. */
  @type("string") targetId = "";
  @type("string") targetName = "";
  @type("number") count = 0;
  @type("string") voterNames = "";
}

/**
 * One player's line on the game-over results screen: their name and true
 * role. Name is denormalised here for the same reason as `meetingBodyName`
 * and `ejectedPlayerName` — some of these players are dead by the time the
 * game ends, and dead players are filtered out of a living client's
 * `players` map entirely, so a name lookup by id would come back empty for
 * exactly the players whose names most need to be on this screen.
 */
export class RevealedPlayer extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") role = "";

  /**
   * Denormalised for the same reason `name` is: cosmetics live on `Player`,
   * which a dead player has already been filtered out of by the time the
   * results screen needs to draw their loadout. `color` rides along too —
   * the results screen's pose preview needs it to pick the right archetype
   * silhouette (see `characters/assign.ts`), and it's equally gone from a
   * living client's stale copy of a dead teammate's `Player` row.
   */
  @type("string") color = "";
  @type("string") hatId = "";
  @type("string") accessoryId = "";
  @type("string") petId = "";
  @type("string") outfitId = "";
  @type("string") victoryPoseId = "";
  @type("string") deathEffectId = "";
}

/**
 * A corpse left where a player was killed. Bodies are public on purpose —
 * finding them is how the living learn a kill happened.
 */
export class Body extends Schema {
  /** Session id of the player this body belongs to. */
  @type("string") playerId = "";
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") color = "";
}

/**
 * The `bodies` map's permanent padding entry (see the field's own doc for
 * why it exists). Never a real session id — Colyseus session ids come from
 * `generateId()` and never look like this — so it can never collide with an
 * actual victim's key, and `GameRoom.handleReportBody` also rejects it by
 * name as defense in depth on top of the filter below always hiding it.
 */
export const PADDING_BODY_ID = "__pad__";

/**
 * Authoritative room state. `phase` drives the overall game flow and starts
 * in the lobby; `hostId` is the session id of the current host (the first
 * player to join, reassigned if they leave).
 */
export class GameState extends Schema {
  /**
   * Every player, filtered per client. This one callback is both the ghost
   * secrecy AND the fog of war: Colyseus evaluates it per client per patch
   * and encodes a *different* byte stream for each, so a player a client is
   * not entitled to see — dead, or beyond their fog — has their movement
   * left off that client's wire entirely. The fog overlay the client draws
   * is presentation; THIS is the boundary the data stops at. Hiding either
   * in the renderer instead would leave every position readable in every
   * client's network traffic, which for this game would be the single most
   * exploitable defect possible.
   *
   * The rules, in order: you always receive yourself (prediction and
   * reconciliation depend on it); the dead see everyone; the living never
   * receive the dead; outside fog phases the living see all the living; in
   * them, only who they can actually see — within their tile's vision
   * radius, no wall between (`canSee`).
   *
   * Two properties of Colyseus's filtering shape everything around this:
   *
   *   1. Filters gate *changes*, not existing data. Nothing is retracted
   *      when visibility closes — the viewer keeps a stale copy and simply
   *      stops receiving updates. Client staleness handling builds on that
   *      (see `GameScene`), as does the ghost catch-up behaviour pinned in
   *      the tests.
   *   2. A filter is only re-evaluated for an entity with a pending change.
   *      A stationary player would otherwise never be re-checked as viewers
   *      move around them — which is exactly why `GameRoom.update` dirties
   *      every position each tick during play. Remove that heartbeat and
   *      the fog silently stops tracking anyone who stands still.
   */
  @filterChildren(function (
    this: GameState,
    client: { sessionId: string },
    key: string,
    value: Player,
  ) {
    if (key === client.sessionId) {
      return true;
    }
    const viewer = this.players.get(client.sessionId);
    if (!viewer) {
      // A connection with no seat (should not happen for joined clients):
      // fall back to the living-only view.
      return value.alive;
    }
    if (!viewer.alive) {
      return true;
    }
    if (!value.alive) {
      return false;
    }
    // The lamplighter's signature ability: everyone visible to everyone
    // while the lamp is lit, bypassing ONLY this fog gate — the living/dead
    // split above still applies unchanged.
    if (this.lampLit) {
      return true;
    }
    if (!FOG_PHASES.has(this.phase)) {
      return true;
    }
    return canSee(viewer, value, this.sabotageActive);
  })
  @type({ map: Player })
  players = new MapSchema<Player>();

  /**
   * Corpses — filtered by the same fog as the players. A body's location is
   * exactly the information a hidden kill is supposed to conceal: finding
   * it should take walking the town, not reading the byte stream. The dead
   * see every body; the living only those within their vision. (A body,
   * once seen, stays truthful in a client's stale copy — bodies never move
   * — so nothing more needs retracting when the viewer walks away.)
   *
   * Permanently contains one extra entry keyed `PADDING_BODY_ID`, invisible
   * to every client including ghosts (the filter's first check, below) —
   * seeded once in `GameRoom.onCreate` and never removed. This exists purely
   * to close a measured packet-size side channel: a distant, fully-filtered
   * client's per-tick patch is a few bytes LARGER the instant this map holds
   * at least one entry than while it is empty, regardless of how many real
   * bodies exist past that point (confirmed: 0 real bodies -> baseline, 1 or
   * 2 real bodies -> same +2B, identical either way) — so with the map
   * permanently non-empty from before any player can possibly die, that step
   * has already happened for everyone before the first kill, and a real
   * body's arrival changes nothing more a size-watching observer could key
   * on. `GameRoom.clearRealBodies` is what lets a meeting clear every real
   * body without ever touching this one — never call `bodies.clear()`
   * directly, or the very step this exists to hide happens again on the next
   * kill.
   */
  @filterChildren(function (
    this: GameState,
    client: { sessionId: string },
    key: string,
    value: Body,
  ) {
    if (key === PADDING_BODY_ID) {
      return false;
    }
    const viewer = this.players.get(client.sessionId);
    if (!viewer) {
      return true;
    }
    if (!viewer.alive) {
      return true;
    }
    if (!FOG_PHASES.has(this.phase)) {
      return true;
    }
    // A body carries no `lanternState` of its own — its lantern has already
    // separately detached and hit the ground (§4.4's death sequence) by the
    // time a corpse exists at all, so it never gets the extinguished-target
    // detection cap; a body is found at the viewer's ordinary vision range.
    return canSee(viewer, { x: value.x, y: value.y, lanternState: "dropped" }, this.sabotageActive);
  })
  @type({ map: Body })
  bodies = new MapSchema<Body>();

  @type("string") phase: string = PHASE.LOBBY;
  @type("string") hostId = "";

  /**
   * The lobby's role settings: which roles from the shared registry
   * (`shared/config/roles.ts`) this game deals, and which preset the host
   * last picked (`"custom"` after a manual toggle). Host-written, lobby-only
   * — see `GameRoom.handleSetPreset` / `handleSetRoleEnabled`.
   *
   * Public on purpose, and NOT an exception to the "no roles in public
   * state" rule on `Player`: these are the game's *rules*, a pure function
   * of host inputs that every client needs identically (to render the lobby
   * panel and compute the stranger tally). They carry no player→role
   * mapping — the thing that rule actually protects.
   */
  @type(["string"]) enabledRoleIds = new ArraySchema<string>();
  @type("string") rolePreset = "";

  /**
   * Balance settings: every host-tunable number/toggle from
   * `shared/config/settings.ts`'s `SETTING_DEFINITIONS` (stranger count, kill
   * cooldown, discussion/voting timers, task count, confirm-ejects), each
   * stored as a plain string keyed by its setting id — see
   * `serializeSettingValue`/`parseSettingValue`. One generic map rather than
   * one schema field per setting, same reasoning as `enabledRoleIds`: adding
   * a new tunable is one registry entry, not a schema change. Host-written,
   * lobby-only — see `GameRoom.handleSetSetting`. Public for the same reason
   * `enabledRoleIds` is: every client needs it identically (e.g. to compute
   * the reveal screen's stranger tally when `strangerCount` overrides the
   * default threshold table).
   */
  @type({ map: "string" }) settings = new MapSchema<string>();

  /**
   * Meeting context, set whenever a meeting starts. `meetingBodyName` is a
   * deliberate denormalisation: the reported player is dead by the time the
   * meeting begins, and dead players are filtered out of a living client's
   * `players` map entirely, so looking their name up by id would come back
   * empty for everyone but the ghosts. Copying the name in at report time
   * sidesteps that. `meetingBodyId` is empty for an emergency meeting.
   *
   * `meetingBodyRoom` is the same idea applied to the body's location — the
   * §10.3 meeting-call cutscene's title names the room a reported body was
   * found in, and `startMeeting` clears the `bodies` map on the same tick it
   * sets this, so there is no body left to read a position back off of by
   * the time a client would want it. Computed once at report time via
   * `roomSlugAt`, the same helper `killPlayer`'s `deathLocations` entry uses.
   * Empty for an emergency meeting, same as `meetingBodyId`.
   */
  @type("string") meetingReporterId = "";
  @type("string") meetingBodyId = "";
  @type("string") meetingBodyName = "";
  @type("string") meetingBodyRoom = "";
  @type("boolean") meetingIsEmergency = false;

  /** Which sub-stage of the meeting is running; empty outside a meeting. */
  @type("string") meetingStage = "";

  /**
   * Everyone known to be dead, rebuilt at the start of every meeting (and
   * appended to on ejection).
   *
   * This is published at meeting time rather than at the moment of death on
   * purpose: mid-round, a killing nobody has discovered must stay unknown, so
   * the only public trace is the body itself. By the time a meeting opens, who
   * is missing is legitimately common knowledge — and the clients need it,
   * because bodies get cleared here and an ejected player never leaves one.
   */
  @type(["string"]) deadPlayerIds = new ArraySchema<string>();

  /** Per-candidate results, published only once voting has resolved. */
  @type({ map: VoteTally }) voteResults = new MapSchema<VoteTally>();

  /**
   * Outcome of the last vote. `ejectedPlayerName` is denormalised for the
   * same reason as `meetingBodyName`: the ejected player is dead by the time
   * this is read, so a living client can no longer look their name up.
   *
   * `ejectedWasStranger` is only ever written when `CONFIRM_EJECTS` is on.
   * With it off, no role information reaches public state at all.
   */
  @type("string") ejectedPlayerId = "";
  @type("string") ejectedPlayerName = "";
  @type("boolean") ejectedWasStranger = false;
  @type("boolean") ejectionConfirmed = false;

  /**
   * The shared task bar. Both fields count only *real* (townsfolk) task
   * steps — a stranger's completions are never added to `taskBarCompleted`,
   * see `GameRoom.handleTaskInteract`. This is safe to be public: the
   * percentage of tasks done reveals nothing about who did them.
   */
  @type("number") taskBarCompleted = 0;
  @type("number") taskBarTotal = 0;

  /**
   * Whether a sabotage is active — set by the Stranger's `sabotage` and the
   * Saboteur's `advanced_sabotage` abilities. Drives the bell lock
   * (`BELL_LOCKED_DURING_SABOTAGE`), the client's alarm stinger/tension
   * music/color grade, watchman camera blinding, and — via the `canSee`
   * calls above — a shrunk vision radius for every player, symmetrically
   * (see `visionRadiusAt`'s `sabotageActive` parameter; there is no
   * per-viewer faction check here on purpose, since `Player` deliberately
   * carries no faction — see its own doc comment). Public rather than
   * server-only: an active sabotage is meant to be an alarm everyone hears,
   * not hidden information.
   */
  @type("boolean") sabotageActive = false;

  /**
   * Room slugs whose doors are currently locked by a Saboteur's `lock_door`
   * — see `applyInputWithLocks` (`shared/game/movement.ts`), which both
   * client prediction and server simulation consult identically. Public for
   * the same reason `sabotageActive` is: a locked door is a physical, visible
   * thing, not hidden information.
   */
  @type(["string"]) lockedRoomSlugs = new ArraySchema<string>();

  /**
   * Whether the Saboteur's comms sabotage is active — the client hides the
   * task list and room labels while this is true. Public: everyone loses
   * comms together, the same way everyone hears the sabotage alarm.
   */
  @type("boolean") commsSabotageActive = false;

  /**
   * Whether a critical sabotage (Lighthouse failure/flooding) is currently
   * counting down. Public — the whole town needs to see the clock and the
   * repair prompts, not just whoever's near a repair point.
   */
  @type("boolean") criticalSabotageActive = false;

  /**
   * Which of the two `CRITICAL_REPAIR_POINTS` have been fixed so far this
   * critical sabotage — cleared the instant a new one starts. Both entries
   * present resolves it; the countdown running out with fewer than both ends
   * the game for the Strangers instead. Public for the same reason the
   * countdown itself is.
   */
  @type(["string"]) criticalRepairedPoints = new ArraySchema<string>();

  /**
   * Whether the lamplighter's lamp is currently lit — see the `lampLit`
   * bypass on `players`'s `filterChildren` above. Public rather than a
   * private message: everyone experiences a lit lamp together, the same way
   * everyone hears the sabotage alarm.
   */
  @type("boolean") lampLit = false;

  /** Set once the game ends (a `FACTION` value); empty while play continues. */
  @type("string") winningFaction = "";
  /** Which condition ended the game — a `WIN_REASON` value. */
  @type("string") winReason = "";

  /**
   * Every player's name and true role, keyed by session id. Populated only at
   * game over, and this is the one deliberate place role information becomes
   * public — see the note on `Player` for why a role field must never live
   * there instead.
   */
  @type({ map: RevealedPlayer }) finalRoster = new MapSchema<RevealedPlayer>();
}
