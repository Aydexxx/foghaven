import { Room, ServerError, type Client, type Deferred } from "@colyseus/core";
import {
  applyInputWithLocks,
  canSee,
  sanitizeDirection,
  resolveRoleCounts,
  ROLE_DEFINITIONS,
  ROLES,
  FACTION,
  factionOf,
  roleById,
  fillRole,
  presetRoleIds,
  PRESET,
  PRESET_CUSTOM,
  type Faction,
  type Preset,
  type AbilityStateMessage,
  type AbilitySlot,
  type Direction,
  type Role,
  type RoomSlug,
  type Vec2,
  roomSlugAt,
  TASK_ROOM_ANCHOR,
  DETECTIVE_TRACE_WINDOW_MS,
  LAMP_DURATION_MS,
  TICK_RATE,
  INPUT_RATE,
  SIM_DT,
  MIN_PLAYERS,
  MAX_PLAYERS,
  PLAYER_COLORS,
  JOIN_ERROR,
  RECONNECT_GRACE_MS,
  PHASE,
  ROLE_REVEAL_MS,
  TASK_DEFINITIONS,
  TASK_DEFINITIONS_BY_ID,
  type ClientTask,
  TASK_INTERACT_RADIUS,
  KILL_INITIAL_DELAY_MS,
  GHOSTS_CAN_DO_TASKS,
  TOWN_HALL,
  MEETING_SPAWN_RADIUS,
  REPORT_BODY_RANGE,
  BELL_RANGE,
  EMERGENCY_MEETINGS_PER_PLAYER,
  BELL_LOCKED_DURING_SABOTAGE,
  RESULTS_MS,
  MEETING_STAGE,
  SKIP_VOTE,
  VOTES_ARE_CHANGEABLE,
  VOTES_ARE_PUBLIC,
  TIE_EJECTS_NOBODY,
  MAX_CHAT_LENGTH,
  CHAT_COOLDOWN_MS,
  CHAT_CHANNEL,
  type ChatChannel,
  screenText,
  isReportReason,
  CHAT_BURST_MAX,
  CHAT_BURST_WINDOW_MS,
  CHAT_REPEAT_MAX,
  SPAM_MUTE_MS,
  BLOCKED_MESSAGE_MUTE_THRESHOLD,
  VOTE_MUTE_MS,
  VOTE_MUTE_SHARE,
  VOTE_MUTE_MIN_PLAYERS,
  REPORT_CHAT_EXCERPT_LINES,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_RATE_MAX,
  REPORT_RATE_WINDOW_MS,
  COINS_PER_ROUND,
  COINS_WIN_BONUS,
  WIN_REASON,
  type WinReason,
  CRITICAL_REPAIR_POINTS,
  type CriticalRepairPointId,
  REPAIR_RANGE,
  SETTING_DEFINITIONS,
  settingById,
  parseSettingValue,
  coerceSettingValue,
  serializeSettingValue,
  type GameSummaryMessage,
  type GameSummaryVoteRound,
  VOICE_MODE,
  VOICE_CHANNEL,
  type VoiceRosterMessage,
  type VoiceSignalMessage,
  lanternColors,
  LANTERN_TOGGLE_COOLDOWN_MS,
} from "@foghaven/shared";
import { GameState, Player, Body, VoteTally, RevealedPlayer, PADDING_BODY_ID } from "./schema/GameState";
import { generateRoomCode, randomSpawn, pickRandom } from "./util";
import { ABILITIES, cameras, voteWeights, type AbilityContext } from "../abilities";
import { getAuthProvider, type Identity } from "../auth/provider";
import { getFriendProvider } from "../friends/provider";
import { getModerationProvider } from "../moderation/provider";
import { getCosmeticProvider } from "../cosmetics/provider";
import { getStatsProvider, type GameStatEntry } from "../stats/provider";
import { RateLimiter } from "../auth/rateLimit";
import { buildIceServers } from "../voice/turn";
import * as Sentry from "@sentry/node";
import { roomLogger, type Logger } from "../logger";
import { activeRooms, concurrentPlayers, matchDurationSeconds, tickDurationMs } from "../metrics";
import { logAntiCheatEvent } from "../anticheat";

const TICK_INTERVAL_MS = 1000 / TICK_RATE;

/** A single queued input command from a client. */
interface InputCommand {
  seq: number;
  dir: Direction;
}

/** Per-client input state: a bounded queue plus a rate-limiting token budget. */
interface InputState {
  queue: InputCommand[];
  budget: number;
}

/**
 * Cap on buffered inputs per client. Inputs beyond this are dropped (oldest
 * first) so a flooding client cannot grow server memory without bound.
 */
const MAX_QUEUED_INPUTS = INPUT_RATE;

/**
 * Cap on the token budget, in commands. Allows a short catch-up burst after
 * network jitter, but bounds how many inputs a client can bank — which bounds
 * the maximum speed a flooding client can ever achieve to the legitimate rate.
 */
const MAX_INPUT_BUDGET = INPUT_RATE;

/** One player's server-authoritative progress on one assigned task. */
interface TaskProgress {
  totalSteps: number;
  completedSteps: number;
}

export interface JoinOptions {
  /** Guest display name — used only when there is no authenticated account. */
  name?: string;
  /** Auth token from login/register; absent for a guest (see `onAuth`). */
  token?: string;
  /** Whether this connection is CREATING the room or JOINING one — guests may only join. */
  intent?: "create" | "join";
}

/** Whether guests (no account) may join at all — an accounts-only deployment sets this false. */
function guestsAllowed(): boolean {
  return process.env.ALLOW_GUESTS !== "false";
}

export class GameRoom extends Room<GameState> {
  /**
   * One above `MAX_PLAYERS` on purpose. The matchmaker auto-locks a room the
   * moment `maxClients` is reached, and a locked room rejects joins with the
   * same generic code a nonexistent room code produces — so a full room would
   * be indistinguishable from a typo. Leaving one seat of headroom lets the
   * over-capacity joiner reach `onAuth`, which refuses them with a code that
   * actually says "full".
   */
  override maxClients = MAX_PLAYERS + 1;

  /** Room-scoped structured logger, stamped with `roomId` — set first thing in `onCreate`, once `roomId` itself is assigned. */
  private log!: Logger;

  /** Server-only input buffers, keyed by session id. Never part of the state. */
  private readonly inputs = new Map<string, InputState>();

  /**
   * Session ids that have opted into proximity voice — asked for the ICE
   * config and are running a WebRTC mesh. A player only appears in another's
   * voice roster once they are in here, so nobody wastes a peer connection on a
   * client that hasn't turned voice on. Cleared on disconnect and departure;
   * a reconnecting client re-registers itself. Server-only: this is transport
   * bookkeeping, not game state.
   */
  private readonly voiceReady = new Set<string>();

  /**
   * Session ids killed while `PLAYING` whose death has not yet been publicly
   * disclosed (no body reported, no meeting called) — server-only, voice
   * bookkeeping, not game state. `voicePeersFor` treats anyone in this set as
   * still "alive" for the purposes of ROSTER SHAPE ONLY, so a distant living
   * client's peer count doesn't shrink the instant a stranger strikes; what
   * actually silences the victim during this window is
   * `VoiceRosterMessage.deathMuted`, computed straight from the real `alive`
   * flag in `sendVoiceRoster`, independent of this set.
   *
   * A kill during `MEETING` (the constable's shot) never enters here — the
   * graveyard is published immediately in that case (see `killPlayer`), so
   * there is nothing left to keep undisclosed. Cleared entirely the instant
   * any meeting starts (`startMeeting`), which is exactly when every death so
   * far becomes legitimately public knowledge via `deadPlayerIds`.
   */
  private readonly undisclosedKills = new Set<string>();

  /**
   * The last `VoiceRosterMessage` actually sent to each client, serialised —
   * server-only, voice bookkeeping. `sendVoiceRoster` skips the send when the
   * newly computed roster is identical to this, because `broadcastVoiceRosters`
   * fires unconditionally on every event that COULD move some client's wall
   * (a kill, an ejection, a phase change, a voice peer joining or leaving) —
   * most of which change nothing for most clients. Without this, a distant
   * witness would receive a content-identical `voiceRoster` message on the
   * exact tick of a covert kill: the CONTENT leak is what `isVoiceAlive`
   * closes, but an unprompted extra message is itself a timing signal, and
   * this is what closes that half.
   */
  private readonly lastSentVoiceRoster = new Map<string, string>();

  /**
   * Secret roles, keyed by session id. This map is the single source of truth
   * for who is what, and it never leaves the server except as the per-client
   * "role" message each player receives about themselves.
   */
  private readonly roles = new Map<string, Role>();

  /**
   * Server-authoritative task progress: session id -> task id -> progress.
   * Whether a given entry counts toward the public bar is decided purely by
   * looking up that session's role in `roles` at completion time — nothing
   * here is ever written to `state`.
   */
  private readonly tasks = new Map<string, Map<string, TaskProgress>>();

  /**
   * Server-only ability cooldowns, keyed by `` `${sessionId}:${abilityId}` ``
   * (see `abilityKey`) -> earliest timestamp (ms) at which that specific
   * ability may fire again. Composite-keyed rather than by session id alone
   * because a role can now have several abilities (Stranger, Saboteur), each
   * on its own independent timer. The client is told a *duration* for its
   * UI, but this is the only value that decides whether an ability fires.
   */
  private readonly abilityReadyAt = new Map<string, number>();

  /**
   * Server-only remaining ability uses, same composite key as
   * `abilityReadyAt`, seeded from each ability slot's own `uses` at deal
   * time. `Infinity` never leaves the server — the client is told `null` for
   * unlimited (see `AbilityStateMessage`).
   */
  private readonly abilityUsesLeft = new Map<string, number>();

  /**
   * A Shapeshifter's real name/color, stashed while their public `name`/
   * `color` fields are swapped to a disguise target's — see `disguiseAs`.
   * Restored on expiry, on death, on ejection, or the instant a meeting
   * starts. Never in `state`: the whole point is that nothing distinguishes
   * a disguised player's public fields from an undisguised one.
   */
  private readonly disguises = new Map<string, { name: string; color: string }>();

  /**
   * How many sabotage triggers are currently pending resolution — base
   * Stranger and Saboteur can both be in one game, and their windows can
   * overlap. Reference-counted rather than tracked by comparing deadlines:
   * each `triggerSabotage` call increments this and decrements it again when
   * its own timer fires, only clearing `state.sabotageActive` once the count
   * reaches zero — so a shorter, later trigger can never cut a longer,
   * earlier one short, and there's no clock-precision comparison to get
   * subtly wrong.
   */
  private pendingSabotageCount = 0;

  /** Same idea as `pendingSabotageCount`, per locked room — see `lockDoor`. */
  private readonly pendingLockCounts = new Map<RoomSlug, number>();

  /**
   * When the current critical sabotage's countdown ends, for display
   * purposes only (telling a reconnecting client how much is left — see
   * `handleReconnect`). Never consulted to decide whether to actually clear
   * anything; that's `pendingSabotageCount`'s job, via `triggerSabotage`.
   */
  private criticalSabotageEndsAt = 0;

  /**
   * Silencer targets queued for the *next* meeting to start — see
   * `pendingSilence` (the `AbilityContext` primitive) and `startMeeting`,
   * which drains this into `silencedThisMeeting` for exactly that one
   * meeting.
   */
  private readonly pendingSilences = new Set<string>();

  /** Sessions whose chat is gagged for the meeting currently in progress. */
  private readonly silencedThisMeeting = new Set<string>();

  /**
   * Cross-ability state for the current round of play (e.g. the doctor's
   * shields — see `server/src/abilities/`). Cleared whenever a meeting
   * starts, the game ends, or the room returns to the lobby, which is what
   * gives every effect stored here a "lasts until the next meeting" lifetime
   * without any timer of its own.
   */
  private readonly roundStore = new Map<string, unknown>();

  /**
   * Where and by whom each player who died a real death (never an ejection —
   * that's already public, so it would produce no new information) was
   * killed. Backs the medium's commune. Persists the whole game; cleared in
   * `handleReturnToLobby`.
   */
  private readonly deathLocations = new Map<
    string,
    { room: RoomSlug; killerFaction: Faction | null }
  >();

  /**
   * Which dead players each medium has already been told about, so a
   * commune never repeats a clue within one game. Persists the whole game;
   * cleared in `handleReturnToLobby`.
   */
  private readonly mediumRevealed = new Map<string, Set<string>>();

  /**
   * Last-seen timestamp per living player per room, overwritten (not
   * appended) each tick they're there — naturally bounded at
   * `rooms × players`, no pruning needed. Populated in `update()` alongside
   * the fog heartbeat. Backs the detective's witness trace
   * (`DETECTIVE_TRACE_WINDOW_MS`). Persists the whole game; cleared in
   * `handleReturnToLobby`.
   */
  private readonly roomPresence = new Map<RoomSlug, Map<string, number>>();

  /** Server-only emergency-meeting usage: session id -> bell rings used. */
  private readonly emergencyMeetingsUsed = new Map<string, number>();

  /** Server-only anti-strobe guard: session id -> `Date.now()` of their last lantern toggle. See `LANTERN_TOGGLE_COOLDOWN_MS`. */
  private readonly lastLanternToggleAt = new Map<string, number>();

  /**
   * Ballots for the current vote: voter session id -> target session id (or
   * `SKIP_VOTE`). Server-only. Only aggregate counts are ever published, and
   * individual ballots only if `VOTES_ARE_PUBLIC` — until then this map is
   * the sole record of who chose whom.
   */
  private readonly votes = new Map<string, string>();

  /** The pending meeting stage transition, so it can be cancelled/replaced. */
  private meetingTimer?: { clear(): void };

  /**
   * The pending critical-sabotage timeout — cleared early if the town
   * repairs both points before it fires, so an already-resolved critical
   * sabotage can never later declare a stranger win out from under a game
   * that's already moved on.
   */
  private criticalSabotageTimer?: { clear(): void };

  /** Per-client chat rate limiting: session id -> last accepted timestamp. */
  private readonly lastChatAt = new Map<string, number>();

  /**
   * Set when a win is detected mid-ejection-reveal, so the results screen
   * still gets its `RESULTS_MS` on screen before `endMeeting` turns it into
   * game over instead of resuming play. A kill or a task completion has no
   * results screen in the way, so those go straight to `declareGameOver`.
   */
  private pendingGameOver: { faction: Faction; reason: WinReason } | null = null;

  /**
   * In-flight reconnection grace periods, keyed by session id. Holding the
   * deferred lets the room *end* a grace period early — see `removePlayer`,
   * which is how a round starting sweeps away players who never came back.
   */
  private readonly reconnections = new Map<string, Deferred<Client>>();

  /**
   * Session id -> account id, for every connected player who is a real
   * account (never a guest — see `onJoin`). Backs `onAuth`'s block check —
   * `state.hostId` is a session id, and a fresh joiner has to be compared
   * against the *account* the current host is signed in as, not the session
   * that happens to hold the seat right now — and moderation, which needs a
   * durable identity to attach a report or a chat log line to.
   */
  private readonly sessionUserIds = new Map<string, string>();

  // --- Moderation ----------------------------------------------------------

  /**
   * Everyone currently silenced, and until when (epoch ms). Covers all three
   * routes to a mute — the host muting someone, a vote-mute carrying, and the
   * automatic spam mute — because from the chat path's point of view they are
   * the same thing, and collapsing them means there is exactly one check to
   * get right rather than three.
   *
   * Server-only and room-scoped on purpose: a mute is a local remedy for a
   * local nuisance. Anything that should follow a player between rooms is a
   * ban, which lives in the database and is enforced at `onAuth`.
   */
  private readonly mutedUntil = new Map<string, number>();

  /** Vote-mute ballots: target session id -> the session ids voting to mute them. */
  private readonly muteVotes = new Map<string, Set<string>>();

  /** Rolling chat burst budget per session — the flood limiter above the per-message cooldown. */
  private readonly chatBurst = new RateLimiter(CHAT_BURST_MAX, CHAT_BURST_WINDOW_MS);

  /** The last thing each session said and how many times running, for repeat-flood detection. */
  private readonly lastChatText = new Map<string, { text: string; count: number }>();

  /** How many slur-tier messages each session has had refused, for the auto-mute threshold. */
  private readonly blockedMessageCount = new Map<string, number>();

  /** Per-reporter budget, so the moderation queue itself cannot be flooded. */
  private readonly reportLimiter = new RateLimiter(REPORT_RATE_MAX, REPORT_RATE_WINDOW_MS);

  /**
   * The room's recent chat, kept in memory purely so a report can carry an
   * excerpt as evidence without a database round trip at filing time. Capped
   * at `REPORT_CHAT_EXCERPT_LINES`; the durable copy is the `ChatLog` table.
   */
  private readonly recentChat: Array<{ senderName: string; text: string; sentAt: string }> = [];

  // --- Stats & end-of-game summary ------------------------------------------

  /**
   * When the world actually opened (phase became PLAYING), for survival-time
   * stats. 0 outside a round. Every win condition only ever fires once play
   * has started, so this is always set by the time `declareGameOver` reads it.
   */
  private gameStartedAt = 0;

  /**
   * When each player's real death (a kill) or ejection landed, session id ->
   * epoch ms — the other end of a survival-time measurement. A player who
   * makes it to the results screen simply has no entry here, so `declareGameOver`
   * falls back to "now" for them. Deliberately separate from `deathLocations`
   * (which only ever records real kills, for the medium): this needs
   * ejections too, and never needs a room or killer faction.
   */
  private readonly diedAt = new Map<string, number>();

  /**
   * One entry per resolved meeting this game, appended in `resolveVotes` —
   * before the *next* meeting's `startMeeting` clears `this.votes` — so the
   * end-of-game summary can show every round's ballot, not just the last
   * one. See `broadcastGameSummary` and `GameSummaryVoteRound`'s own doc for
   * why `ballots` is usually empty.
   */
  private readonly voteHistory: GameSummaryVoteRound[] = [];

  override onCreate(): void {
    // Replace the framework-generated id with a short, human-readable code.
    // Assigning here (before the room is registered) means the matchmaker and
    // monitor both use this code as the room's id.
    this.roomId = generateRoomCode();
    this.log = roomLogger(this.roomId);
    activeRooms.inc();
    this.log.info("room created");

    this.setState(new GameState());

    // Seeded once, for the room's entire lifetime, before any player can
    // possibly die — see the field's own doc on `GameState.bodies` for why.
    // Never touched again after this; `clearRealBodies` is the only other
    // code allowed to modify `bodies`, and it is written to never remove
    // this specific key.
    const padding = new Body();
    padding.playerId = PADDING_BODY_ID;
    this.state.bodies.set(PADDING_BODY_ID, padding);

    // The default role set. Presets and per-role toggles only ever move
    // these two fields — see `handleSetPreset` / `handleSetRoleEnabled`.
    this.state.rolePreset = PRESET.CLASSIC;
    this.state.enabledRoleIds.push(...presetRoleIds(PRESET.CLASSIC));

    // The balance settings' defaults, one entry per registry definition — a
    // lobby that never touches these reproduces today's exact hardcoded
    // values. See `handleSetSetting` for how the host adjusts them, and
    // `getNumberSetting`/`getBooleanSetting` for how game logic reads them.
    for (const definition of SETTING_DEFINITIONS) {
      this.state.settings.set(definition.id, serializeSettingValue(definition.default));
    }

    // The ONLY movement channel: a direction intent plus a sequence number.
    // The server never accepts a position from a client.
    this.onMessage("input", (client, message) => this.enqueueInput(client, message));

    this.onMessage("start", (client) => this.handleStart(client));

    this.onMessage("set_preset", (client, message) => this.handleSetPreset(client, message));

    this.onMessage("set_role_enabled", (client, message) =>
      this.handleSetRoleEnabled(client, message),
    );

    this.onMessage("set_setting", (client, message) => this.handleSetSetting(client, message));

    this.onMessage("task_interact", (client, message) =>
      this.handleTaskInteract(client, message),
    );

    this.onMessage("ability", (client, message) => this.handleAbility(client, message));

    this.onMessage("repair_critical", (client, message) =>
      this.handleRepairCritical(client, message),
    );

    this.onMessage("report_body", (client, message) =>
      this.handleReportBody(client, message),
    );

    this.onMessage("call_meeting", (client) => this.handleCallMeeting(client));

    this.onMessage("toggle_lantern", (client) => this.handleToggleLantern(client));

    this.onMessage("vote", (client, message) => this.handleVote(client, message));

    this.onMessage("chat", (client, message) => this.handleChat(client, message));

    this.onMessage("return_to_lobby", (client) => this.handleReturnToLobby(client));

    // Moderation. `report` is available from anywhere including the results
    // screen — the end of a round is exactly when people finally have the
    // attention to report what happened during it.
    this.onMessage("report", (client, message) => void this.handleReport(client, message));

    this.onMessage("mute", (client, message) => this.handleHostMute(client, message));

    this.onMessage("vote_mute", (client, message) => this.handleVoteMute(client, message));

    // Proximity voice. `voice_ready` opts a client into the mesh (and gets it
    // the ICE config); `voice_stop` opts back out; `voice_signal` is the
    // WebRTC signalling relay, gated by the same living/dead wall as chat.
    this.onMessage("voice_ready", (client) => this.handleVoiceReady(client));
    this.onMessage("voice_stop", (client) => this.handleVoiceStop(client));
    this.onMessage("voice_signal", (client, message) => this.relayVoiceSignal(client, message));

    this.setSimulationInterval(() => {
      const startedAt = performance.now();
      this.update();
      tickDurationMs.observe(performance.now() - startedAt);
    }, TICK_INTERVAL_MS);
  }

  /**
   * Colyseus's own exception hook: fires for anything thrown inside a room
   * lifecycle method (`onJoin`, `onLeave`, an `onMessage` handler, the
   * simulation interval callback above, etc.) that isn't otherwise caught.
   * Without this override such an exception previously vanished — visible
   * only as a dead-quiet room in the Colyseus monitor, never in a log or in
   * Sentry.
   */
  override onUncaughtException(error: Error, methodName: string): void {
    this.log.error({ err: error, methodName }, "uncaught exception in room lifecycle method");
    Sentry.captureException(error, { tags: { methodName, roomId: this.roomId } });
  }

  override onDispose(): void {
    activeRooms.dec();
    this.log.info("room disposed");
  }

  /**
   * Authenticate the identity, then decide whether a *new* join is allowed.
   *
   * This is THE ban chokepoint: every fresh join passes through here, and a
   * banned account never gets past it (the check is re-run against the database
   * on every join, so a ban issued mid-session takes effect on the next join).
   * The returned identity becomes `client.auth`, which `onJoin` reads for the
   * authoritative display name.
   *
   * Each refusal throws a code the client can act on — banned, invalid token,
   * guest-tried-to-create, room full, already started — because the matchmaker
   * reports a locked or nonexistent room identically, so without our own codes
   * a mistyped room code and a banned account would look the same.
   *
   * Reconnections do not pass through here at all — Colyseus resolves those
   * straight from the reconnection token — so a dropped player reclaims their
   * held seat without re-authenticating. The seat was authorized when it was
   * first taken, and a ban that lands mid-round still stops their *next* join.
   */
  override async onAuth(client: Client, options: JoinOptions = {}): Promise<Identity> {
    const auth = await getAuthProvider().authenticate(options.token, {
      allowGuests: guestsAllowed(),
    });
    if (!auth.ok) {
      if (auth.error === "banned") {
        logAntiCheatEvent(this.log, "join_banned", { sessionId: client.sessionId });
        const reason = auth.ban?.reason ? `: ${auth.ban.reason}` : "";
        throw new ServerError(JOIN_ERROR.BANNED, `banned${reason}`);
      }
      throw new ServerError(JOIN_ERROR.AUTH_INVALID, "sign in to play");
    }

    // Guests may join a friend's room but never conjure one of their own — the
    // main way a banned person would otherwise keep spinning up lobbies. The
    // client also hides "Create Room" from guests; this is the authoritative
    // half of that rule.
    if (auth.value.isGuest && options.intent === "create") {
      throw new ServerError(JOIN_ERROR.GUEST_NO_CREATE, "sign in to create a room");
    }

    // A joiner who has a block relationship with the current host is turned
    // away — this is the friend system's "avoid matching them where
    // possible" rule, applied at the one place this game actually has
    // anything resembling matchmaking: joining a room someone else is
    // hosting. Guests are exempt on both sides (no account, so no block row
    // can exist), and a room between hosts is fine to re-check on every join
    // since the host can change mid-lobby.
    if (auth.value.userId) {
      const hostUserId = this.sessionUserIds.get(this.state.hostId);
      if (hostUserId && hostUserId !== auth.value.userId) {
        if (await getFriendProvider().isBlocked(hostUserId, auth.value.userId)) {
          logAntiCheatEvent(this.log, "join_blocked", {
            sessionId: client.sessionId,
            userId: auth.value.userId,
          });
          throw new ServerError(JOIN_ERROR.BLOCKED, "blocked by the host");
        }
      }
    }

    if (this.state.players.size >= MAX_PLAYERS) {
      throw new ServerError(JOIN_ERROR.ROOM_FULL, "room is full");
    }
    // Roles are dealt once, at the start; there is no way to hand a latecomer
    // one without also telling them what they missed.
    if (this.state.phase !== PHASE.LOBBY) {
      throw new ServerError(JOIN_ERROR.IN_PROGRESS, "game already in progress");
    }
    return auth.value;
  }

  override onJoin(client: Client, options: JoinOptions = {}, auth?: Identity): void {
    const player = new Player();
    player.id = client.sessionId;
    // A registered player's name is their account username, taken from the
    // verified identity — NOT from `options.name`, so nobody can log in as
    // "Ada" and then present themselves in-game as someone else. A guest has
    // no account name, so their (client-supplied) display name is used, with a
    // safe fallback.
    player.name = auth?.isGuest === false
      ? auth.username
      : options.name?.trim() || `Player-${client.sessionId.slice(0, 4)}`;

    const spawn = randomSpawn();
    player.x = spawn.x;
    player.y = spawn.y;

    player.color = this.pickColor();
    player.lanternColor = this.pickLanternColor();
    player.alive = true;
    player.lanternState = "lit";

    this.state.players.set(client.sessionId, player);
    concurrentPlayers.inc();
    this.inputs.set(client.sessionId, { queue: [], budget: 0 });
    if (auth?.userId) {
      this.sessionUserIds.set(client.sessionId, auth.userId);
      this.applyCosmeticLoadout(client.sessionId, auth.userId);
    }

    // First player in becomes the host — as does the first to arrive after
    // every host has gone.
    this.ensureConnectedHost();
  }

  /**
   * Fetch this account's saved loadout and write it onto their `Player` row
   * — fire-and-forget, deliberately not awaited by `onJoin`. Cosmetics are
   * decorative by design (see the doc on `Player.hatId` and its siblings),
   * so a slow or failed lookup should cost a player their hat for one round,
   * never delay the join itself or drop them from the room.
   */
  private applyCosmeticLoadout(sessionId: string, userId: string): void {
    const provider = getCosmeticProvider();
    if (!provider) {
      return;
    }
    void provider
      .getLoadout(userId)
      .then((loadout) => {
        // The player may already have left by the time this resolves —
        // session ids are never reused, so a missing entry here means gone,
        // not "someone else now."
        const player = this.state.players.get(sessionId);
        if (!player) {
          return;
        }
        player.hatId = loadout.hatId;
        player.accessoryId = loadout.accessoryId;
        player.petId = loadout.petId;
        player.outfitId = loadout.outfitId;
        player.victoryPoseId = loadout.victoryPoseId;
        player.deathEffectId = loadout.deathEffectId;
      })
      .catch(() => {
        // See above — a bare Player with every cosmetic slot empty is a
        // perfectly valid, fully playable outcome.
      });
  }

  /**
   * Handle a client going away.
   *
   * A deliberate leave is final. An unexpected drop is not: the player keeps
   * their seat for `RECONNECT_GRACE_MS`, staying on the map with their role,
   * tasks and cooldown intact, and only becomes a real departure if that
   * window closes without them. Awaiting `allowReconnection` is what holds the
   * room open — it reserves the seat, which also stops an emptied room from
   * disposing out from under the players who are on their way back.
   */
  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    if (!player) {
      return;
    }

    if (consented) {
      this.removePlayer(sessionId);
      return;
    }

    player.connected = false;

    // Drop anything they had queued, so they don't lurch across the map on
    // the strength of inputs sent before they vanished.
    const inputState = this.inputs.get(sessionId);
    if (inputState) {
      inputState.queue.length = 0;
      inputState.budget = 0;
    }

    // Their voice mesh went down with the socket. Deregister them and update
    // every peer's roster so the living (or the dead) tear the connection down
    // now rather than talking to a stalled peer. They re-register with a fresh
    // `voice_ready` if they make it back inside the grace window.
    this.voiceReady.delete(sessionId);
    this.broadcastVoiceRosters();

    // Nobody should sit staring at a ballot waiting on a player who isn't
    // there, and the room shouldn't sit hostless while its host is away.
    this.resolveIfEveryoneVoted();
    this.ensureConnectedHost();

    const reconnection = this.allowReconnection(client, RECONNECT_GRACE_MS / 1000);
    this.reconnections.set(sessionId, reconnection);

    try {
      this.handleReconnect(await reconnection);
    } catch {
      // The grace period expired, or the room ended it early. Either way this
      // is now an ordinary departure.
      this.removePlayer(sessionId);
    }
  }

  /**
   * Welcome a player back. Their seat, position, role and progress were all
   * held for them; what has to be redone is every *private* message, because
   * those went to a socket that no longer exists. Public state needs nothing —
   * Colyseus resends it in full on reconnection.
   */
  private handleReconnect(client: Client): void {
    const sessionId = client.sessionId;
    this.reconnections.delete(sessionId);

    const player = this.state.players.get(sessionId);
    if (!player) {
      // Removed while they were away (a round started without them).
      return;
    }

    player.connected = true;

    const role = this.roles.get(sessionId);
    if (role) {
      client.send("role", {
        role,
        fellows: this.fellowNames(sessionId),
      });
    }

    const tasks = this.taskPayload(sessionId);
    if (tasks) {
      client.send("tasks", { tasks });
    }

    // Send what is *left* of the cooldown, not the full duration — coming back
    // must not re-arm a timer they had already been waiting out. Uses come
    // back too: a doctor who spent their shield must not return to a live
    // button. One message per ability slot — a role can have several now.
    const definition = role ? roleById(role) : undefined;
    for (const slot of definition?.abilities ?? []) {
      const readyAt = this.abilityReadyAt.get(this.abilityKey(sessionId, slot.ability));
      if (readyAt !== undefined) {
        this.sendAbilityState(sessionId, slot.ability, Math.max(0, readyAt - Date.now()));
      }
    }

    // Same "what's left, not the full thing" reasoning as the ability
    // cooldown above — a reconnecting client otherwise has no way to know
    // how much of the repair race is already gone.
    if (this.state.criticalSabotageActive) {
      client.send("criticalSabotageStarted", {
        durationMs: Math.max(0, this.criticalSabotageEndsAt - Date.now()),
      });
    }

    // They may be the only one here, if everyone else drifted off meanwhile.
    this.ensureConnectedHost();
  }

  /**
   * Remove a player for good and settle everything their absence changes.
   *
   * Idempotent, because it is reached from three directions: a deliberate
   * leave, an expired grace period, and a round starting without someone who
   * never came back.
   */
  private removePlayer(sessionId: string): void {
    if (!this.state.players.has(sessionId)) {
      return;
    }
    concurrentPlayers.dec();

    // Captured before the bookkeeping below erases them — whether the town has
    // just run out of strangers depends on what this player was.
    const role = this.roles.get(sessionId);
    const wasLivingStranger =
      this.state.players.get(sessionId)?.alive === true &&
      role !== undefined &&
      factionOf(role) === FACTION.STRANGER;

    this.releaseTaskShare(sessionId);

    const definition = role ? roleById(role) : undefined;
    for (const slot of definition?.abilities ?? []) {
      const key = this.abilityKey(sessionId, slot.ability);
      this.abilityReadyAt.delete(key);
      this.abilityUsesLeft.delete(key);
    }

    this.state.players.delete(sessionId);
    this.inputs.delete(sessionId);
    this.sessionUserIds.delete(sessionId);
    this.roles.delete(sessionId);
    this.tasks.delete(sessionId);
    this.mediumRevealed.delete(sessionId);
    this.emergencyMeetingsUsed.delete(sessionId);
    this.lastLanternToggleAt.delete(sessionId);
    this.votes.delete(sessionId);
    this.lastChatAt.delete(sessionId);
    this.disguises.delete(sessionId);
    this.pendingSilences.delete(sessionId);
    this.silencedThisMeeting.delete(sessionId);
    this.mutedUntil.delete(sessionId);
    this.muteVotes.delete(sessionId);
    this.lastChatText.delete(sessionId);
    this.blockedMessageCount.delete(sessionId);
    this.diedAt.delete(sessionId);
    this.voiceReady.delete(sessionId);
    this.undisclosedKills.delete(sessionId);
    this.lastSentVoiceRoster.delete(sessionId);
    // Ballots this player cast against others go with them, so a departed
    // player can't keep contributing to a vote-mute threshold.
    for (const ballots of this.muteVotes.values()) {
      ballots.delete(sessionId);
    }

    // End any grace period still running for them. Rejecting a deferred that
    // has already settled is a no-op, so the expiry path lands here harmlessly.
    this.reconnections.get(sessionId)?.reject();
    this.reconnections.delete(sessionId);

    // Someone leaving mid-ballot can be the last vote everyone was waiting on.
    this.resolveIfEveryoneVoted();

    this.ensureConnectedHost();

    // Their seat is gone, so every remaining voice peer drops the connection to
    // them. (If the departure ends the game, `declareGameOver` re-broadcasts an
    // empty roster below — harmless, and it keeps this correct on its own.)
    this.broadcastVoiceRosters();

    // A departure changes the head count on both sides, so every win condition
    // is back in play: the last stranger walking out hands the town the game,
    // and enough townsfolk walking out hands it to the strangers.
    if (this.state.phase === PHASE.PLAYING || this.state.phase === PHASE.MEETING) {
      const outcome = this.evaluateWinCondition(wasLivingStranger);
      if (outcome) {
        this.declareGameOver(outcome.faction, outcome.reason);
      }
    }
  }

  /**
   * Take a departing townsfolk's unfinished work off the shared bar.
   *
   * The bar's total is fixed at the start from every townsfolk's list, so
   * without this a single player leaving would make it permanently
   * unreachable and quietly delete one of the town's two ways to win. Steps
   * they already completed stay counted on both sides of the ratio — the work
   * was really done.
   */
  private releaseTaskShare(sessionId: string): void {
    const role = this.roles.get(sessionId);
    if (!role || factionOf(role) !== FACTION.TOWNSFOLK) {
      return;
    }
    const progress = this.tasks.get(sessionId);
    if (!progress) {
      return;
    }
    let outstanding = 0;
    for (const task of progress.values()) {
      outstanding += task.totalSteps - task.completedSteps;
    }
    this.state.taskBarTotal = Math.max(0, this.state.taskBarTotal - outstanding);
  }

  /**
   * Make sure the host is someone who is actually here. Covers the host
   * leaving, the host dropping mid-round, and a room whose last connected
   * player just walked back in. An empty `hostId` is a legitimate resting
   * state: it means nobody is connected to hand it to yet.
   */
  private ensureConnectedHost(): void {
    const current = this.state.players.get(this.state.hostId);
    if (current?.connected) {
      return;
    }

    let next = "";
    this.state.players.forEach((player, id) => {
      if (next === "" && player.connected) {
        next = id;
      }
    });
    this.state.hostId = next;
  }

  /**
   * Start the game. Every check here is authoritative: a non-host request, a
   * short-handed room, or a room already past the lobby is silently ignored
   * rather than trusted — the client only ever *requests* a start, this
   * decides whether it actually happens.
   */
  private handleStart(client: Client): void {
    if (this.state.phase !== PHASE.LOBBY) {
      return;
    }
    if (client.sessionId !== this.state.hostId) {
      return;
    }

    // Anyone still inside their grace period when the round starts is not
    // coming back into *this* round — roles are dealt exactly once, and a
    // player who isn't listening can't be dealt one. Dropping them here also
    // keeps them out of the head count below, so a room cannot start on the
    // strength of players who have already gone.
    const absent: string[] = [];
    this.state.players.forEach((player, id) => {
      if (!player.connected) {
        absent.push(id);
      }
    });
    absent.forEach((id) => this.removePlayer(id));

    if (this.state.players.size < MIN_PLAYERS) {
      return;
    }

    this.emergencyMeetingsUsed.clear();

    // Deal and deliver the secret roles *before* announcing the phase. Messages
    // and state patches share one socket in order, so every client is holding
    // its own role by the time it learns the reveal has begun.
    this.assignRoles();

    // Tasks depend on who is a stranger (their list is fake), so this must
    // come after assignRoles.
    this.assignTasks();

    this.state.phase = PHASE.ROLE_REVEAL;

    // No `lock()` here on purpose. Locking would keep latecomers out, but the
    // matchmaker rejects a locked room with the same code as a nonexistent
    // one — so a player whose friends had just started would be told their
    // room code was wrong. `onAuth` turns them away instead, and says why.

    this.clock.setTimeout(() => {
      this.state.phase = PHASE.PLAYING;
      this.gameStartedAt = Date.now();
      this.startAbilityCooldowns();
      // Voice comes alive with the world — proximity mode. Anyone who had it on
      // in the lobby's waiting room reconnects their mesh from the fresh roster.
      this.broadcastVoiceRosters();
    }, ROLE_REVEAL_MS);
  }

  /**
   * Apply a preset: replace the enabled role set wholesale. Host-gated and
   * lobby-gated for the same reason `handleStart` is — this changes the game
   * for everyone.
   */
  private handleSetPreset(client: Client, message: unknown): void {
    if (this.state.phase !== PHASE.LOBBY || client.sessionId !== this.state.hostId) {
      return;
    }

    const raw = (message ?? {}) as { preset?: unknown };
    const preset = typeof raw.preset === "string" ? raw.preset : undefined;
    if (preset !== PRESET.CLASSIC && preset !== PRESET.CHAOS && preset !== PRESET.PURE) {
      return;
    }

    this.state.rolePreset = preset;
    this.state.enabledRoleIds.clear();
    this.state.enabledRoleIds.push(...presetRoleIds(preset as Preset));
  }

  /**
   * Toggle a single role in or out of the deal. Two locks keep every
   * reachable configuration playable: the fill role (townsfolk — the seats
   * remainder) can never be disabled, and neither can the last enabled
   * stranger-faction role — a game with no strangers has no game in it, and
   * `evaluateWinCondition` is built on every deal containing at least one.
   */
  private handleSetRoleEnabled(client: Client, message: unknown): void {
    if (this.state.phase !== PHASE.LOBBY || client.sessionId !== this.state.hostId) {
      return;
    }

    const raw = (message ?? {}) as { roleId?: unknown; enabled?: unknown };
    const roleId = typeof raw.roleId === "string" ? raw.roleId : undefined;
    const enabled = raw.enabled === true;
    if (!roleId) {
      return;
    }

    const definition = roleById(roleId);
    if (!definition) {
      return;
    }

    const currentlyEnabled = this.state.enabledRoleIds.includes(roleId);
    if (enabled === currentlyEnabled) {
      return;
    }

    if (!enabled) {
      if (definition.fill) {
        return;
      }
      if (definition.faction === FACTION.STRANGER) {
        const otherStrangerRoles = this.state.enabledRoleIds.filter(
          (id) => id !== roleId && roleById(id)?.faction === FACTION.STRANGER,
        );
        if (otherStrangerRoles.length === 0) {
          return;
        }
      }
    }

    if (enabled) {
      this.state.enabledRoleIds.push(roleId);
    } else {
      const index = this.state.enabledRoleIds.indexOf(roleId);
      this.state.enabledRoleIds.splice(index, 1);
    }
    // The set no longer matches any named preset's exact list.
    this.state.rolePreset = PRESET_CUSTOM;
  }

  /**
   * Adjust one balance setting (stranger count, kill cooldown, discussion/
   * voting timers, task count, confirm-ejects, and whatever else
   * `SETTING_DEFINITIONS` grows to hold) — host-only and lobby-only, same
   * gate as every other lobby control. A rejected request (unknown id, wrong
   * value type) leaves `state.settings` untouched rather than throwing; an
   * out-of-range *number*, in contrast, is clamped by `coerceSettingValue`
   * rather than rejected outright — a slightly-too-high request is a usable
   * request, not an attack.
   */
  private handleSetSetting(client: Client, message: unknown): void {
    if (this.state.phase !== PHASE.LOBBY || client.sessionId !== this.state.hostId) {
      return;
    }

    const raw = (message ?? {}) as { id?: unknown; value?: unknown };
    const id = typeof raw.id === "string" ? raw.id : undefined;
    if (!id) {
      return;
    }

    const definition = settingById(id);
    if (!definition) {
      return;
    }

    const value = coerceSettingValue(definition, raw.value);
    if (value === null) {
      return;
    }

    this.state.settings.set(id, serializeSettingValue(value));
  }

  /** A number setting's current value — the host's tuned figure, or the registry default if never touched. */
  private getNumberSetting(id: string): number {
    const definition = settingById(id);
    if (!definition) {
      throw new Error(`Unknown setting "${id}"`);
    }
    return parseSettingValue(definition, this.state.settings.get(id)) as number;
  }

  /** A boolean setting's current value — the host's tuned figure, or the registry default if never touched. */
  private getBooleanSetting(id: string): boolean {
    const definition = settingById(id);
    if (!definition) {
      throw new Error(`Unknown setting "${id}"`);
    }
    return parseSettingValue(definition, this.state.settings.get(id)) as boolean;
  }

  /**
   * An ability's actual cooldown, honoring the host's `killCooldownMs`
   * balance setting for the Stranger's `kill` specifically — the one setting
   * that doesn't map onto a single standalone constant a room can just read,
   * since `KILL_COOLDOWN_MS` today only ever appears baked into the
   * registry's `kill` ability slot (evaluated once at module load, not
   * per-room). Every other ability keeps its registry-fixed cooldown.
   */
  private cooldownFor(slot: AbilitySlot): number {
    return slot.ability === "kill" ? this.getNumberSetting("killCooldownMs") : slot.cooldownMs;
  }

  /**
   * Arm the ability timer of every ability every player's role has, as the
   * world opens. The clock starts here rather than at role assignment so
   * the initial grace period covers actual play time, not the reveal
   * screen.
   */
  private startAbilityCooldowns(): void {
    const readyAt = Date.now() + KILL_INITIAL_DELAY_MS;
    // Driven from `players` rather than `clients` because a player inside
    // their grace period has no client to iterate — but their cooldown is
    // still running, and `handleReconnect` hands them what's left of it.
    this.state.players.forEach((_player, sessionId) => {
      const role = this.roles.get(sessionId);
      const definition = role ? roleById(role) : undefined;
      for (const slot of definition?.abilities ?? []) {
        this.abilityReadyAt.set(this.abilityKey(sessionId, slot.ability), readyAt);
        this.sendAbilityState(sessionId, slot.ability, KILL_INITIAL_DELAY_MS);
      }
    });
  }

  /** Composite key for the per-ability cooldown/uses maps — a role can have several abilities now. */
  private abilityKey(sessionId: string, abilityId: string): string {
    return `${sessionId}:${abilityId}`;
  }

  /**
   * Tell one player one ability's availability. `usesLeft` crosses the wire
   * as null for unlimited — `Infinity` does not survive serialization.
   */
  private sendAbilityState(sessionId: string, abilityId: string, cooldownMs: number): void {
    const usesLeft = this.abilityUsesLeft.get(this.abilityKey(sessionId, abilityId)) ?? 0;
    const payload: AbilityStateMessage = {
      abilityId,
      cooldownMs,
      usesLeft: Number.isFinite(usesLeft) ? usesLeft : null,
    };
    this.clientFor(sessionId)?.send("abilityState", payload);
  }

  /** The live connection for a session id, if that player is currently here. */
  private clientFor(sessionId: string): Client | undefined {
    return this.clients.find((client) => client.sessionId === sessionId);
  }

  /**
   * Deal roles at random from the lobby's enabled role set and tell each
   * player only what they are entitled to know. Distribution comes entirely
   * from config — `resolveRoleCounts` reads the shared registry — and the
   * deal is one unbiased shuffle sliced per role, so which role a given
   * player draws is uniform. Nothing about the assignment is written to
   * `state`; the only copies that leave the server are each client's own
   * private "role" message.
   */
  private assignRoles(): void {
    const sessionIds = [...this.state.players.keys()];
    const enabledIds: string[] = [];
    this.state.enabledRoleIds.forEach((id) => enabledIds.push(id));
    // 0 is the "Auto" sentinel — leave the base Stranger role's own
    // per-headcount threshold table alone. A positive value forces exactly
    // that many, still subject to `resolveRoleCounts`'s own parity clamp.
    const strangerCount = this.getNumberSetting("strangerCount");
    const overrides: Record<string, number> =
      strangerCount > 0 ? { [ROLES.STRANGER]: strangerCount } : {};
    const counts = resolveRoleCounts(sessionIds.length, enabledIds, overrides);
    const shuffled = pickRandom(sessionIds, sessionIds.length);

    this.roles.clear();
    this.abilityUsesLeft.clear();

    let cursor = 0;
    const fill = fillRole();
    for (const definition of ROLE_DEFINITIONS) {
      if (definition.id === fill.id) {
        continue;
      }
      const count = counts[definition.id] ?? 0;
      for (const sessionId of shuffled.slice(cursor, cursor + count)) {
        this.roles.set(sessionId, definition.id);
      }
      cursor += count;
    }
    for (const sessionId of shuffled.slice(cursor)) {
      this.roles.set(sessionId, fill.id);
    }

    for (const sessionId of sessionIds) {
      const role = this.roles.get(sessionId)!;
      for (const slot of roleById(role)?.abilities ?? []) {
        this.abilityUsesLeft.set(this.abilityKey(sessionId, slot.ability), slot.uses);
      }
      this.clientFor(sessionId)?.send("role", {
        role,
        fellows: this.fellowNames(sessionId),
      });
    }
  }

  /**
   * The names of a player's faction-mates — and only for roles whose
   * definition says holders know each other (`revealsFellows`: strangers
   * conspire; a townsfolk-faction role never learns who its "fellows" are).
   * Everyone else gets an empty list, which is what makes the payload safe
   * to build from a single code path here and in `handleReconnect`:
   * re-sending a role on reconnection can never leak more than the first
   * send did.
   */
  private fellowNames(sessionId: string): string[] {
    const role = this.roles.get(sessionId);
    if (!role || !roleById(role)?.revealsFellows) {
      return [];
    }
    const faction = factionOf(role);
    const names: string[] = [];
    this.state.players.forEach((player, id) => {
      if (id === sessionId) {
        return;
      }
      const otherRole = this.roles.get(id);
      if (otherRole && factionOf(otherRole) === faction) {
        names.push(player.name);
      }
    });
    return names;
  }

  /**
   * Deal every player a task list — every "common" task plus a random draw of
   * the rest — and deliver it privately. A stranger's list has the exact same
   * shape as a townsfolk's; only `assignRoles` decided who is which, and only
   * `handleTaskInteract` ever checks it again. The shared bar's total is the
   * sum of *townsfolk* steps only, fixed for the round the moment it starts.
   */
  private assignTasks(): void {
    const commonDefs = TASK_DEFINITIONS.filter((task) => task.type === "common");
    const pool = TASK_DEFINITIONS.filter((task) => task.type !== "common");
    const tasksPerPlayer = this.getNumberSetting("tasksPerPlayer");

    this.tasks.clear();
    let totalRealSteps = 0;

    this.state.players.forEach((_player, sessionId) => {
      const assigned = [...commonDefs, ...pickRandom(pool, tasksPerPlayer)];

      const progress = new Map<string, TaskProgress>();
      for (const def of assigned) {
        progress.set(def.id, { totalSteps: def.steps.length, completedSteps: 0 });
      }
      this.tasks.set(sessionId, progress);

      const role = this.roles.get(sessionId);
      if (role && factionOf(role) === FACTION.TOWNSFOLK) {
        totalRealSteps += assigned.reduce((sum, def) => sum + def.steps.length, 0);
      }

      this.clientFor(sessionId)?.send("tasks", { tasks: this.taskPayload(sessionId) });
    });

    this.state.taskBarCompleted = 0;
    this.state.taskBarTotal = totalRealSteps;
  }

  /**
   * Build one player's task list as the client sees it, from the server's own
   * progress record. Used both when tasks are first dealt and when a returning
   * player needs the list rebuilt — with their progress already in it, so
   * reconnecting never costs anyone work they had done.
   */
  private taskPayload(sessionId: string): ClientTask[] | null {
    const progress = this.tasks.get(sessionId);
    if (!progress) {
      return null;
    }

    const payload: ClientTask[] = [];
    for (const [taskId, task] of progress) {
      const def = TASK_DEFINITIONS_BY_ID.get(taskId);
      if (!def) {
        continue;
      }
      payload.push({
        id: def.id,
        type: def.type,
        minigame: def.minigame,
        room: def.room,
        x: def.x,
        y: def.y,
        totalSteps: task.totalSteps,
        completedSteps: task.completedSteps,
      });
    }
    return payload;
  }

  /**
   * Handle one "E" press. Every check here is authoritative — the client's
   * proximity indicator is UX only, this is what actually decides whether the
   * interaction counts:
   *   - the player must have this exact task in their own assigned list
   *   - the task must not already be finished
   *   - the player's server-tracked position must be within interact range
   * The player is always told their own new progress, real or fake — that's
   * what makes the two indistinguishable on their own screen. Only a
   * townsfolk's completion is added to the public bar.
   */
  private handleTaskInteract(client: Client, message: unknown): void {
    if (this.state.phase !== PHASE.PLAYING) {
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    if (!player.alive && !GHOSTS_CAN_DO_TASKS) {
      return;
    }

    const raw = (message ?? {}) as { taskId?: unknown };
    const taskId = typeof raw.taskId === "string" ? raw.taskId : undefined;
    if (!taskId) {
      return;
    }

    const definition = TASK_DEFINITIONS_BY_ID.get(taskId);
    if (!definition) {
      return;
    }

    const progress = this.tasks.get(client.sessionId)?.get(taskId);
    if (!progress || progress.completedSteps >= progress.totalSteps) {
      return;
    }

    const distance = Math.hypot(player.x - definition.x, player.y - definition.y);
    if (distance > TASK_INTERACT_RADIUS) {
      return;
    }

    progress.completedSteps += 1;
    client.send("taskProgress", { taskId, completedSteps: progress.completedSteps });

    // This is the one line that decides whether the interaction was real —
    // only townsfolk-faction work fills the bar, whatever the exact role.
    const role = this.roles.get(client.sessionId);
    if (role && factionOf(role) === FACTION.TOWNSFOLK) {
      this.state.taskBarCompleted += 1;
      // The only way the "all tasks done" condition can ever become true, so
      // this is the only place besides a death that needs to check for it.
      this.checkWinConditionNow();
    }
  }

  /**
   * Resolve an ability attempt — the one generic path every role ability
   * goes through. The gates checked here are exactly the ones every ability
   * shares, and nothing else:
   *   - the actor must be alive and their role must have an ability at all
   *   - the game must be in the phase that ability is usable in (open play
   *     for most roles; a meeting, for Alderman and Constable — see
   *     `RoleDefinition.usablePhase`)
   *   - their cooldown must have elapsed, measured against the server clock
   *   - they must have uses remaining
   * Everything target-shaped (range, line of sight, faction rules, which
   * meeting sub-stage) belongs to the ability itself — see
   * `server/src/abilities/`. A rejected attempt is silently ignored and does
   * not touch the cooldown or uses, so spamming the message buys nothing.
   * The client's ability button is a hint, not a permission.
   */
  private handleAbility(client: Client, message: unknown): void {
    const actor = this.state.players.get(client.sessionId);
    if (!actor || !actor.alive) {
      return;
    }

    const role = this.roles.get(client.sessionId);
    const definition = role ? roleById(role) : undefined;
    if (!definition) {
      return;
    }

    const raw = (message ?? {}) as {
      abilityId?: unknown;
      targetId?: unknown;
      roomSlug?: unknown;
      roleGuess?: unknown;
    };
    const abilityId = typeof raw.abilityId === "string" ? raw.abilityId : undefined;
    // The slot must actually be one of THIS role's abilities — a client
    // naming an ability id its role doesn't have is rejected here, same as
    // any other invalid input.
    const slot = abilityId
      ? definition.abilities.find((candidate) => candidate.ability === abilityId)
      : undefined;
    const ability = slot ? ABILITIES[slot.ability] : undefined;
    if (!slot || !ability) {
      // A missing abilityId is just a malformed/empty message; naming one
      // that doesn't resolve to this role's own abilities is the actual
      // spoof signal — the client's ability button only ever sends one it
      // was dealt.
      if (abilityId) {
        logAntiCheatEvent(this.log, "ability_spoof", {
          sessionId: client.sessionId,
          userId: this.sessionUserIds.get(client.sessionId) ?? null,
          detail: { abilityId },
        });
      }
      return;
    }

    const requiredPhase = slot.usablePhase === "meeting" ? PHASE.MEETING : PHASE.PLAYING;
    if (this.state.phase !== requiredPhase) {
      return;
    }

    const key = this.abilityKey(client.sessionId, slot.ability);
    const readyAt = this.abilityReadyAt.get(key);
    if (readyAt === undefined || Date.now() < readyAt) {
      logAntiCheatEvent(this.log, "ability_cooldown", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { ability: slot.ability },
      });
      return;
    }

    const usesLeft = this.abilityUsesLeft.get(key) ?? 0;
    if (usesLeft <= 0) {
      logAntiCheatEvent(this.log, "ability_no_uses", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { ability: slot.ability },
      });
      return;
    }

    const targetId = typeof raw.targetId === "string" ? raw.targetId : undefined;
    const roomSlug = typeof raw.roomSlug === "string" ? raw.roomSlug : undefined;
    const roleGuess = typeof raw.roleGuess === "string" ? raw.roleGuess : undefined;

    const fired = ability.execute(
      this.abilityContext(client, actor, targetId, roomSlug, roleGuess),
    );
    if (!fired) {
      return;
    }

    const cooldownMs = this.cooldownFor(slot);
    this.abilityReadyAt.set(key, Date.now() + cooldownMs);
    this.abilityUsesLeft.set(key, usesLeft - 1);
    this.sendAbilityState(client.sessionId, slot.ability, cooldownMs);
  }

  /** The room slugs a camera may actually be placed in — real, walled rooms only (no Town Hall, no open Streets). */
  private static readonly PLACEABLE_ROOMS = new Set<string>(Object.keys(TASK_ROOM_ANCHOR));

  /** The narrow room facade an ability executes against — see `abilities/types.ts`. */
  private abilityContext(
    client: Client,
    actor: Player,
    targetId: string | undefined,
    roomSlug: string | undefined,
    roleGuess: string | undefined,
  ): AbilityContext {
    return {
      actorId: client.sessionId,
      targetId,
      actor,
      target: targetId ? this.state.players.get(targetId) : undefined,
      targetBody: targetId ? this.state.bodies.get(targetId) : undefined,
      targetRoom:
        roomSlug && GameRoom.PLACEABLE_ROOMS.has(roomSlug) ? (roomSlug as RoomSlug) : undefined,
      meetingStage: this.state.meetingStage,
      guessedRole: roleGuess,
      factionOf: (sessionId) => {
        const role = this.roles.get(sessionId);
        return role ? factionOf(role) : undefined;
      },
      roleIdOf: (sessionId) => this.roles.get(sessionId),
      withinRange: (a, b, range) => Math.hypot(a.x - b.x, a.y - b.y) <= range,
      // Walls stop abilities the way they stop sight. Ranges are wider than
      // a wall is thick, so without this an ability could reach through the
      // bricks into the next room.
      canSee,
      kill: (victim) => this.killPlayer(victim, client.sessionId),
      sendToActor: (type, payload) => client.send(type, payload),
      communeWithDead: () => this.communeWithDead(client.sessionId),
      findWitness: (room, excludeIds) => this.findWitness(room, excludeIds),
      litLamp: (durationMs) => this.litLamp(durationMs),
      triggerSabotage: (durationMs) => this.triggerSabotage(durationMs),
      lockDoor: (room, durationMs) => this.lockDoor(room, durationMs),
      criticalSabotageActive: this.state.criticalSabotageActive,
      triggerComms: (durationMs) => this.triggerComms(durationMs),
      triggerCriticalSabotage: (durationMs) => this.triggerCriticalSabotage(durationMs),
      teleportActor: (pos, otherEnd) => this.teleportActor(client.sessionId, pos, otherEnd),
      disguiseAs: (targetSessionId, durationMs) =>
        this.disguiseAs(client.sessionId, targetSessionId, durationMs),
      pendingSilence: (targetSessionId) => this.pendingSilences.add(targetSessionId),
      ejectSelf: () => {
        this.ejectPlayer(client.sessionId);
        this.checkWinConditionNow();
      },
      roundStore: this.roundStore,
    };
  }

  /**
   * One factual clue about a dead player this medium hasn't heard yet — the
   * room they died in and their killer's faction — or null once the pool is
   * exhausted for this game. Only real kills are candidates; an ejection is
   * already public and would produce no new information.
   */
  private communeWithDead(
    mediumId: string,
  ): { name: string; room: RoomSlug; killerFaction: Faction | null } | null {
    const alreadyHeard = this.mediumRevealed.get(mediumId) ?? new Set<string>();
    const candidates = [...this.deathLocations.keys()].filter((id) => !alreadyHeard.has(id));
    if (candidates.length === 0) {
      return null;
    }
    const [deadId] = pickRandom(candidates, 1);
    if (!deadId) {
      return null;
    }
    alreadyHeard.add(deadId);
    this.mediumRevealed.set(mediumId, alreadyHeard);

    const location = this.deathLocations.get(deadId)!;
    const name = this.state.players.get(deadId)?.name ?? "?";
    return { name, room: location.room, killerFaction: location.killerFaction };
  }

  /**
   * One random session recently seen in `room` (per `roomPresence`, within
   * `DETECTIVE_TRACE_WINDOW_MS`), excluding `excludeIds` — the detective's
   * circumstantial witness. Not necessarily the killer; just whoever was
   * there. `apparentFaction` is the witness's real faction, except a Decoy
   * witness always reads as townsfolk — the whole of the Decoy's trick.
   */
  private findWitness(
    room: RoomSlug,
    excludeIds: string[],
  ): { name: string; apparentFaction: Faction } | null {
    const seen = this.roomPresence.get(room);
    if (!seen) {
      return null;
    }
    const now = Date.now();
    const excluded = new Set(excludeIds);
    const candidates: string[] = [];
    seen.forEach((lastSeenAt, sessionId) => {
      if (!excluded.has(sessionId) && now - lastSeenAt <= DETECTIVE_TRACE_WINDOW_MS) {
        candidates.push(sessionId);
      }
    });
    if (candidates.length === 0) {
      return null;
    }
    const [witnessId] = pickRandom(candidates, 1);
    if (!witnessId) {
      return null;
    }
    const witnessRole = this.roles.get(witnessId);
    const realFaction = witnessRole ? factionOf(witnessRole) : FACTION.TOWNSFOLK;
    const apparentFaction = witnessRole === ROLES.DECOY ? FACTION.TOWNSFOLK : realFaction;
    return { name: this.state.players.get(witnessId)?.name ?? "?", apparentFaction };
  }

  /**
   * Light the lamp: every living player becomes visible to every other
   * living player for `durationMs` (see the `lampLit` bypass on
   * `GameState.players`'s `filterChildren`), then the fog resumes exactly
   * as before. Public state, not a private message — a lit lamp is a shared
   * event everyone experiences together.
   */
  private litLamp(durationMs: number): void {
    this.state.lampLit = true;
    this.clock.setTimeout(() => {
      this.state.lampLit = false;
    }, durationMs);
  }

  /**
   * Start (or extend) a sabotage: the shared `sabotageActive` flag drives
   * the bell lock, camera blinding, alarm stinger/tension music/color grade,
   * and — via `canSee`'s `sabotageActive` parameter on `GameState`'s fog
   * filters — a town-wide vision shrink, all pre-existing. Reference-counted
   * rather than tracked by comparing deadlines (see `pendingSabotageCount`'s
   * doc) because two different roles can each trigger a sabotage of their
   * own duration (Stranger's base one and the Saboteur's longer one), and
   * their windows can overlap.
   */
  private triggerSabotage(durationMs: number): void {
    this.pendingSabotageCount += 1;
    this.state.sabotageActive = true;
    this.clock.setTimeout(() => {
      this.pendingSabotageCount = Math.max(0, this.pendingSabotageCount - 1);
      if (this.pendingSabotageCount === 0) {
        this.state.sabotageActive = false;
      }
    }, durationMs);
  }

  /**
   * Lock a room's doors for `durationMs` — see `applyInputWithLocks` in
   * `shared/game/movement.ts`, which both client prediction and server
   * simulation consult identically. Same reference-counting reasoning as
   * `triggerSabotage`, per room.
   */
  private lockDoor(room: RoomSlug, durationMs: number): void {
    this.pendingLockCounts.set(room, (this.pendingLockCounts.get(room) ?? 0) + 1);
    if (!this.state.lockedRoomSlugs.includes(room)) {
      this.state.lockedRoomSlugs.push(room);
    }
    this.clock.setTimeout(() => {
      const remaining = Math.max(0, (this.pendingLockCounts.get(room) ?? 1) - 1);
      if (remaining === 0) {
        this.pendingLockCounts.delete(room);
        const index = this.state.lockedRoomSlugs.indexOf(room);
        if (index >= 0) {
          this.state.lockedRoomSlugs.splice(index, 1);
        }
      } else {
        this.pendingLockCounts.set(room, remaining);
      }
    }, durationMs);
  }

  /**
   * Black out the task list and room labels for `durationMs` — the
   * Saboteur's comms sabotage. Public, momentary, no other side effect: no
   * alarm, no vision change, unlike the fog or critical sabotages.
   */
  private triggerComms(durationMs: number): void {
    this.state.commsSabotageActive = true;
    this.clock.setTimeout(() => {
      this.state.commsSabotageActive = false;
    }, durationMs);
  }

  /**
   * Start the critical sabotage countdown (Lighthouse failure/flooding).
   * Rejects (fires nothing) if one is already running — only one critical
   * failure can be in flight at a time. Reuses `triggerSabotage` for the
   * duration of the countdown so the existing bell-lock, alarm stinger,
   * tension music and atmosphere color grade all apply for free — this is
   * meant to be the single most alarming sabotage in the game.
   */
  private triggerCriticalSabotage(durationMs: number): boolean {
    if (this.state.criticalSabotageActive) {
      return false;
    }
    this.state.criticalSabotageActive = true;
    this.state.criticalRepairedPoints.clear();
    this.criticalSabotageEndsAt = Date.now() + durationMs;
    this.triggerSabotage(durationMs);
    this.broadcast("criticalSabotageStarted", { durationMs });

    this.criticalSabotageTimer = this.clock.setTimeout(() => {
      this.resolveCriticalSabotage(false);
    }, durationMs);
    return true;
  }

  /**
   * End the critical sabotage, either because the town repaired both points
   * in time (`repaired: true`) or the clock ran out first (`repaired:
   * false`, which hands the Strangers the game). Idempotent — whichever path
   * gets there first cancels the other, so a dangling timeout can never fire
   * a second, contradictory resolution after the first one already landed.
   */
  private resolveCriticalSabotage(repaired: boolean): void {
    if (!this.state.criticalSabotageActive) {
      return;
    }
    this.state.criticalSabotageActive = false;
    this.criticalSabotageTimer?.clear();
    this.criticalSabotageTimer = undefined;
    this.criticalSabotageEndsAt = 0;
    this.broadcast("criticalSabotageResolved", { repaired });

    if (!repaired) {
      this.declareGameOver(FACTION.STRANGER, WIN_REASON.CRITICAL_SABOTAGE);
    }
  }

  /**
   * Repair one of the two critical sabotage points. Anyone living may
   * repair, regardless of faction — the same as Among Us lets an impostor
   * technically fix their own sabotage. Both points repaired resolves the
   * critical sabotage without ending the game.
   */
  private handleRepairCritical(client: Client, message: unknown): void {
    if (!this.state.criticalSabotageActive) {
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) {
      return;
    }

    const raw = (message ?? {}) as { pointId?: unknown };
    const pointId = typeof raw.pointId === "string" ? raw.pointId : undefined;
    const point = pointId
      ? CRITICAL_REPAIR_POINTS[pointId as CriticalRepairPointId]
      : undefined;
    if (!point) {
      return;
    }
    if (this.state.criticalRepairedPoints.includes(pointId!)) {
      return;
    }
    const distance = Math.hypot(player.x - point.x, player.y - point.y);
    if (distance > REPAIR_RANGE) {
      logAntiCheatEvent(this.log, "repair_out_of_range", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { pointId: pointId!, distance: Math.round(distance) },
      });
      return;
    }

    this.state.criticalRepairedPoints.push(pointId!);
    if (
      this.state.criticalRepairedPoints.length >= Object.keys(CRITICAL_REPAIR_POINTS).length
    ) {
      this.resolveCriticalSabotage(true);
    }
  }

  /**
   * Teleport the actor directly to `pos` (the Stranger's tunnel) and
   * broadcast an audible cue at both the tunnel's fixed endpoints to every
   * connected client, unfiltered by fog — the "vent equivalent" is never
   * fully invisible. This reveals only that a sound happened at two already-
   * public map locations, never who caused it; each client decides for
   * itself whether it's close enough to either point to actually hear it.
   */
  private teleportActor(actorId: string, pos: Vec2, otherEnd: Vec2): void {
    const actor = this.state.players.get(actorId);
    if (!actor) {
      return;
    }
    actor.x = pos.x;
    actor.y = pos.y;
    this.broadcast("tunnelSound", { points: [pos, otherEnd] });
  }

  /**
   * Take on `targetId`'s name and color for `durationMs` — the Shapeshifter.
   * Swaps the real public fields rather than adding sibling "disguise"
   * fields on purpose: a sibling field would leave the real values sitting
   * on the wire right next to it, readable by anyone inspecting raw
   * traffic, defeating the whole point (see `Player`'s own doc comment on
   * why role secrecy never works that way). The real pair is stashed here,
   * server-only, and restored by `restoreDisguise` — on expiry, on death, on
   * ejection, or the instant a meeting starts (`startMeeting`).
   */
  private disguiseAs(actorId: string, targetId: string, durationMs: number): void {
    const actor = this.state.players.get(actorId);
    const target = this.state.players.get(targetId);
    if (!actor || !target) {
      return;
    }
    // A re-cast can't land mid-disguise in practice (this ability's cooldown
    // always exceeds its own duration), so there is never a stashed pair to
    // clobber here — but guard anyway rather than assume it.
    if (!this.disguises.has(actorId)) {
      this.disguises.set(actorId, { name: actor.name, color: actor.color });
    }
    actor.name = target.name;
    actor.color = target.color;
    this.clock.setTimeout(() => this.restoreDisguise(actorId), durationMs);
  }

  /**
   * Restore a Shapeshifter's real name/color, if a disguise is currently
   * active for them. Safe to call unconditionally — a no-op if there's
   * nothing stashed, which covers the timer firing after the disguise was
   * already cleared early (death, ejection, a meeting starting).
   */
  private restoreDisguise(sessionId: string): void {
    const real = this.disguises.get(sessionId);
    if (!real) {
      return;
    }
    const player = this.state.players.get(sessionId);
    if (player) {
      player.name = real.name;
      player.color = real.color;
    }
    this.disguises.delete(sessionId);
  }

  /**
   * Removes every REAL body — a meeting starting, or a full return to the
   * lobby — while leaving `PADDING_BODY_ID` untouched. The only sanctioned
   * way to empty `bodies`: a bare `this.state.bodies.clear()` would also
   * delete the padding entry, reopening the exact packet-size side channel
   * it exists to close the very next time someone dies.
   */
  private clearRealBodies(): void {
    for (const key of [...this.state.bodies.keys()]) {
      if (key !== PADDING_BODY_ID) {
        this.state.bodies.delete(key);
      }
    }
  }

  /**
   * Mark a player dead and leave a body where they fell. Flipping `alive`
   * is what makes them vanish from every living client's state — see the
   * `filterChildren` on `GameState.players`.
   */
  private killPlayer(victim: Player, killerId: string): void {
    // Restore their real identity first, so the body left behind (and
    // anything reading `victim.name` below) shows who they actually were —
    // a shapeshift confuses *live* observers, not the death record.
    this.restoreDisguise(victim.id);

    victim.alive = false;
    // §4.4's death sequence: the lantern detaches and hits the ground. This
    // is what tells every ghost's Havener (and, via `visionRadiusAt`,
    // nothing — a dead player already bypasses the fog entirely) that this
    // player's light is now on the ground, not in their hand.
    victim.lanternState = "dropped";
    // First death only — a constable's mutual kill or any other path that
    // might somehow touch the same player twice must not push their
    // survival-time end back out.
    if (!this.diedAt.has(victim.id)) {
      this.diedAt.set(victim.id, Date.now());
    }

    const body = new Body();
    body.playerId = victim.id;
    body.name = victim.name;
    body.x = victim.x;
    body.y = victim.y;
    body.color = victim.color;
    this.state.bodies.set(victim.id, body);

    // The medium's raw material — where and by whom, for a fact the medium
    // may surface later. Recorded for every real kill, including a
    // constable's mutual self-kill (killerId === victim.id there).
    const killerRole = this.roles.get(killerId);
    this.deathLocations.set(victim.id, {
      room: roomSlugAt(victim.x, victim.y),
      killerFaction: killerRole ? factionOf(killerRole) : null,
    });

    // Tell the victim directly. They cannot infer it from `alive` alone
    // without a race, and this is what drives their death animation.
    this.clientFor(victim.id)?.send("killed", { by: killerId });

    // A kill during a meeting (the constable's shot) needs the graveyard
    // updated immediately — it was already frozen for this meeting's ballot
    // when `startMeeting` ran, so without this the ballot would keep
    // offering a vote for someone already dead until the *next* meeting.
    // Safe to publish instantly here: everyone is already gathered with no
    // fog during a meeting, so nothing is protected by waiting.
    if (this.state.phase === PHASE.MEETING && !this.state.deadPlayerIds.includes(victim.id)) {
      this.state.deadPlayerIds.push(victim.id);
    } else if (this.state.phase === PHASE.PLAYING) {
      // A covert kill — undisclosed until the next body report or meeting
      // call. See `undisclosedKills`'s own doc for what this does and does
      // not protect.
      this.undisclosedKills.add(victim.id);
    }

    // The instant they die, the victim's own roster becomes the graveyard —
    // except a covert (PLAYING-phase) kill deliberately does NOT move the
    // wall for anyone else yet: `voicePeersFor` keeps listing the victim in
    // their former living peers' rosters (via `undisclosedKills`) so a
    // distant client can't infer a kill from a roster shrinking by one. What
    // silences the victim regardless is `deathMuted`, computed from the real
    // `alive` flag in `sendVoiceRoster` — their mic is dead from this instant
    // even though their id lingers in other rosters as cover.
    this.broadcastVoiceRosters();

    // A kill during PLAYING has no results screen in the way, so a win here
    // can be declared immediately; during MEETING, `evaluateWinCondition`
    // already allows that phase too.
    this.checkWinConditionNow();
  }

  /**
   * Report a body found nearby. The proximity check is against the *specific*
   * body claimed, not "any body on the map" — a client can't report a corpse
   * across the map just by knowing its id.
   */
  private handleReportBody(client: Client, message: unknown): void {
    if (this.state.phase !== PHASE.PLAYING) {
      return;
    }

    const reporter = this.state.players.get(client.sessionId);
    if (!reporter || !reporter.alive) {
      return;
    }

    const raw = (message ?? {}) as { bodyId?: unknown };
    const bodyId = typeof raw.bodyId === "string" ? raw.bodyId : undefined;
    // The padding entry is filtered out for every client (see `GameState`'s
    // doc on `bodies`), so a legitimate client can never learn this id from
    // the wire — but it costs nothing to also refuse it by name outright,
    // rather than relying solely on "the map's own filter always hides it"
    // to keep it unreportable.
    if (!bodyId || bodyId === PADDING_BODY_ID) {
      return;
    }

    const body = this.state.bodies.get(bodyId);
    if (!body) {
      return;
    }

    const distance = Math.hypot(reporter.x - body.x, reporter.y - body.y);
    if (distance > REPORT_BODY_RANGE) {
      return;
    }

    // You can only report a body you can actually see. Body ids are session
    // ids, so without this a client could fish for hidden corpses through a
    // wall by spamming report attempts with every known id. A body has no
    // `lanternState` of its own — see `GameState`'s bodies filter for why
    // "dropped" is the right stand-in.
    if (!canSee(reporter, { x: body.x, y: body.y, lanternState: "dropped" })) {
      logAntiCheatEvent(this.log, "report_fog_of_war", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { bodyId },
      });
      return;
    }

    this.startMeeting({
      reporterId: client.sessionId,
      bodyId,
      bodyName: body.name,
      bodyRoom: roomSlugAt(body.x, body.y),
      isEmergency: false,
    });
  }

  /**
   * Ring the emergency bell at the Town Hall. Limited per player and, once a
   * sabotage mechanic exists, locked while one is active — both enforced only
   * here, never assumed from client state.
   */
  private handleCallMeeting(client: Client): void {
    if (this.state.phase !== PHASE.PLAYING) {
      return;
    }

    const reporter = this.state.players.get(client.sessionId);
    if (!reporter || !reporter.alive) {
      return;
    }

    if (BELL_LOCKED_DURING_SABOTAGE && this.state.sabotageActive) {
      return;
    }

    const used = this.emergencyMeetingsUsed.get(client.sessionId) ?? 0;
    if (used >= EMERGENCY_MEETINGS_PER_PLAYER) {
      logAntiCheatEvent(this.log, "meeting_quota", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { used },
      });
      return;
    }

    const distance = Math.hypot(reporter.x - TOWN_HALL.x, reporter.y - TOWN_HALL.y);
    if (distance > BELL_RANGE) {
      return;
    }

    // Only a successful ring consumes a use — a rejected attempt (out of
    // range, say) must not cost the player their one shot.
    this.emergencyMeetingsUsed.set(client.sessionId, used + 1);

    this.startMeeting({
      reporterId: client.sessionId,
      bodyId: "",
      bodyName: "",
      bodyRoom: "",
      isEmergency: true,
    });
  }

  /**
   * §3.5/§4.1's core hide mechanic: "extinguish your lantern to hide." No
   * role gate — every Havener, Town and Stranger alike, always has this.
   * Flips lit <-> extinguished; a `flickering`/`dropped` lantern doesn't
   * respond to this message at all (there is no player-triggered path INTO
   * flickering yet — see `LanternState`'s doc — and a dropped lantern isn't
   * in anyone's hand to relight).
   *
   * `LANTERN_TOGGLE_COOLDOWN_MS` is a spam guard only, not a mechanic the
   * player is meant to feel — see its own doc.
   */
  private handleToggleLantern(client: Client): void {
    if (this.state.phase !== PHASE.PLAYING) {
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) {
      return;
    }

    if (player.lanternState !== "lit" && player.lanternState !== "extinguished") {
      return;
    }

    const now = Date.now();
    const lastToggle = this.lastLanternToggleAt.get(client.sessionId) ?? 0;
    if (now - lastToggle < LANTERN_TOGGLE_COOLDOWN_MS) {
      return;
    }
    this.lastLanternToggleAt.set(client.sessionId, now);

    player.lanternState = player.lanternState === "lit" ? "extinguished" : "lit";
  }

  /**
   * Pull everyone into a meeting: lock movement, clear every body from the
   * map, and teleport all players to the Town Hall. Voting and returning to
   * play are a later milestone — this only handles the trigger itself.
   */
  private startMeeting(ctx: {
    reporterId: string;
    bodyId: string;
    bodyName: string;
    bodyRoom: RoomSlug | "";
    isEmergency: boolean;
  }): void {
    this.state.meetingReporterId = ctx.reporterId;
    this.state.meetingBodyId = ctx.bodyId;
    this.state.meetingBodyName = ctx.bodyName;
    this.state.meetingBodyRoom = ctx.bodyRoom;
    this.state.meetingIsEmergency = ctx.isEmergency;

    // Movement is locked the instant this flips — see the phase checks in
    // `enqueueInput` and `update`.
    this.state.phase = PHASE.MEETING;

    // Clear the previous round's outcome so the results screen can't show
    // stale data while this meeting is still being discussed.
    this.state.voteResults.clear();
    this.state.ejectedPlayerId = "";
    this.state.ejectedPlayerName = "";
    this.state.ejectedWasStranger = false;
    this.state.ejectionConfirmed = false;

    this.votes.clear();
    this.state.players.forEach((player) => {
      player.hasVoted = false;
    });

    // Publish the graveyard. Legitimate now — see `deadPlayerIds` in the
    // schema for why it is not published at the moment of death.
    this.state.deadPlayerIds.clear();
    this.state.players.forEach((player, id) => {
      if (!player.alive) {
        this.state.deadPlayerIds.push(id);
      }
    });

    // Every covert kill so far is exactly as public as the graveyard just
    // published above now, so nothing is left to hide from a voice roster —
    // clearing this is what lets `voicePeersFor` move the wall for them the
    // very next `broadcastVoiceRosters()` (below), the same tick everyone
    // else learns they're gone.
    this.undisclosedKills.clear();

    // One body found pulls everyone in, so the rest are moot for this round.
    this.clearRealBodies();

    // Deliver every active watchman's footage before the round store (and
    // the cameras living in it) is cleared below — this is the one and only
    // moment a camera's sightings are ever read.
    cameras(this.roundStore).forEach((camera, ownerId) => {
      const names = [...camera.sightings].map((id) => this.state.players.get(id)?.name ?? "?");
      this.clientFor(ownerId)?.send("cameraReveal", {
        roomSlug: camera.roomSlug,
        names,
        blinded: camera.blinded,
      });
    });

    // Round-scoped ability effects (the doctor's shields, watchman cameras,
    // the alderman's armed double vote) end with the round of play that
    // produced them — see the doc on `roundStore`.
    this.roundStore.clear();

    // A Shapeshifter's disguise never carries into a meeting — two ballot
    // rows with the same name/color would be a UI mess this game has no
    // need for, so any active one is forced to expire right now.
    for (const sessionId of [...this.disguises.keys()]) {
      this.restoreDisguise(sessionId);
    }

    // The Silencer's gag activates now: whoever was queued up for the next
    // meeting is silenced for exactly *this* one, and privately told so —
    // this is the point they learn they've been gagged, not who did it.
    this.silencedThisMeeting.clear();
    this.pendingSilences.forEach((sessionId) => {
      this.silencedThisMeeting.add(sessionId);
      this.clientFor(sessionId)?.send("silenced");
    });
    this.pendingSilences.clear();

    // Arrange players in a circle so they don't all stack on one point. Login
    // order is presentation only, not a game rule.
    const ids = [...this.state.players.keys()];
    ids.forEach((id, index) => {
      const player = this.state.players.get(id)!;
      const angle = (index / ids.length) * Math.PI * 2;
      player.x = TOWN_HALL.x + Math.cos(angle) * MEETING_SPAWN_RADIUS;
      player.y = TOWN_HALL.y + Math.sin(angle) * MEETING_SPAWN_RADIUS;

      // Drop anything still queued so nobody lurches on the next input
      // they're allowed to send.
      const inputState = this.inputs.get(id);
      if (inputState) {
        inputState.queue.length = 0;
        inputState.budget = 0;
      }
    });

    this.enterStage(MEETING_STAGE.DISCUSSION);

    // The meeting reshuffles voice: proximity gives way to equal volume (the
    // whole town is gathered), and any Silencer gag now takes hold on the
    // gagged player's own mic. The living/dead split is unchanged — the dead
    // still only hear the dead.
    this.broadcastVoiceRosters();
  }

  /**
   * Advance the meeting stage machine and arm the timer for the next hop.
   * Every transition runs through here so there is exactly one pending timer
   * at a time — a stage that ends early (everyone voted) cancels the timer
   * that would have ended it, rather than racing it.
   */
  private enterStage(stage: string): void {
    this.meetingTimer?.clear();
    this.meetingTimer = undefined;
    this.state.meetingStage = stage;

    if (stage === MEETING_STAGE.DISCUSSION) {
      this.meetingTimer = this.clock.setTimeout(
        () => this.enterStage(MEETING_STAGE.VOTING),
        this.getNumberSetting("discussionMs"),
      );
      return;
    }

    if (stage === MEETING_STAGE.VOTING) {
      this.meetingTimer = this.clock.setTimeout(
        () => this.resolveVotes(),
        this.getNumberSetting("votingMs"),
      );
      // A room where nobody is left alive to vote shouldn't sit on the ballot.
      this.resolveIfEveryoneVoted();
      return;
    }

    if (stage === MEETING_STAGE.RESULTS) {
      this.meetingTimer = this.clock.setTimeout(() => this.endMeeting(), RESULTS_MS);
    }
  }

  /**
   * Record a ballot. Only living players vote, only while the ballot is open,
   * and only for a living player or a skip. Whether a vote may be changed is
   * config; by default the first one sticks.
   */
  private handleVote(client: Client, message: unknown): void {
    if (this.state.phase !== PHASE.MEETING || this.state.meetingStage !== MEETING_STAGE.VOTING) {
      return;
    }

    const voter = this.state.players.get(client.sessionId);
    if (!voter || !voter.alive) {
      return;
    }

    if (!VOTES_ARE_CHANGEABLE && this.votes.has(client.sessionId)) {
      return;
    }

    const raw = (message ?? {}) as { targetId?: unknown };
    const targetId = typeof raw.targetId === "string" ? raw.targetId : undefined;
    if (!targetId) {
      return;
    }

    if (targetId !== SKIP_VOTE) {
      const target = this.state.players.get(targetId);
      // No voting for the dead, and no voting for someone who isn't here.
      if (!target || !target.alive) {
        return;
      }
    }

    this.votes.set(client.sessionId, targetId);
    voter.hasVoted = true;

    this.resolveIfEveryoneVoted();
  }

  /**
   * Close the ballot early once everyone who *can* vote has.
   *
   * A player inside their grace period is deliberately not counted: they still
   * hold their seat and can still be voted for, but they cannot cast a ballot,
   * so waiting on them would hold the whole room at the voting screen until
   * the voting timer ran out. If they make it back before then their vote
   * still counts — `handleVote` calls this again.
   */
  private resolveIfEveryoneVoted(): void {
    if (this.state.meetingStage !== MEETING_STAGE.VOTING) {
      return;
    }

    let voters = 0;
    this.state.players.forEach((player) => {
      if (player.alive && player.connected) {
        voters += 1;
      }
    });

    if (voters > 0 && this.votes.size >= voters) {
      this.resolveVotes();
    }
  }

  /**
   * Count the ballots, eject whoever the room chose, and publish the results.
   *
   * Role information reaches public state here and nowhere else, and only
   * when the `confirmEjects` setting is on — with it off, `ejectedWasStranger`
   * is left at its default and the announcement says only who went.
   */
  private resolveVotes(): void {
    const weights = voteWeights(this.roundStore);
    const counts = new Map<string, number>();
    const voterNames = new Map<string, string[]>();

    for (const [voterId, targetId] of this.votes) {
      // The alderman's armed double vote, if any — everyone else weighs 1.
      const weight = weights.get(voterId) ?? 1;
      counts.set(targetId, (counts.get(targetId) ?? 0) + weight);
      const names = voterNames.get(targetId) ?? [];
      names.push(this.state.players.get(voterId)?.name ?? "?");
      voterNames.set(targetId, names);
    }

    // Publish the tallies. Individual ballots are attached only if votes are
    // configured public; otherwise `voterNames` stays empty and the mapping
    // from voter to choice never leaves this method.
    this.state.voteResults.clear();
    for (const [targetId, count] of counts) {
      const tally = new VoteTally();
      tally.targetId = targetId;
      tally.targetName =
        targetId === SKIP_VOTE ? "" : (this.state.players.get(targetId)?.name ?? "?");
      tally.count = count;
      tally.voterNames = VOTES_ARE_PUBLIC ? (voterNames.get(targetId) ?? []).join(", ") : "";
      this.state.voteResults.set(targetId, tally);
    }

    // Retained for the end-of-game summary — see `broadcastGameSummary` and
    // the doc on `voteHistory`. Captured now, before the *next* meeting's
    // `startMeeting` clears `this.votes` out from under it.
    this.voteHistory.push({
      results: [...counts.entries()].map(([targetId, count]) => ({
        targetId,
        targetName: targetId === SKIP_VOTE ? "" : (this.state.players.get(targetId)?.name ?? "?"),
        count,
      })),
      ballots: VOTES_ARE_PUBLIC
        ? [...this.votes.entries()].map(([voterId, targetId]) => ({
            voterId,
            voterName: this.state.players.get(voterId)?.name ?? "?",
            targetId,
            targetName: targetId === SKIP_VOTE ? "" : (this.state.players.get(targetId)?.name ?? "?"),
          }))
        : [],
    });

    const ejectedId = this.pickEjection(counts);
    if (ejectedId && this.state.players.has(ejectedId)) {
      this.ejectPlayer(ejectedId);

      // An ejection happens inside the results reveal, so a win here can't
      // be declared yet — the ejection itself still has to be shown. Hold
      // it and let `endMeeting` apply it once that screen's had its time.
      this.pendingGameOver = this.evaluateWinCondition();
    }

    this.enterStage(MEETING_STAGE.RESULTS);
  }

  /**
   * Eject a player through the one public path both a vote-eject and the
   * Assassin's wrong guess use. An ejected player leaves no body — they are
   * thrown out, not killed where they stood — so the graveyard alone is what
   * tells clients they're gone. Restores a Shapeshifter's real identity
   * first, same reasoning as `killPlayer`: the ejection record should name
   * who they actually were, not whoever they were disguised as.
   */
  private ejectPlayer(sessionId: string): void {
    const ejected = this.state.players.get(sessionId);
    if (!ejected) {
      return;
    }
    this.restoreDisguise(sessionId);

    const confirmEjects = this.getBooleanSetting("confirmEjects");
    ejected.alive = false;
    // Same as a kill — see `killPlayer`'s doc on this field. An ejection
    // leaves no body, but the lantern still hits the ground as they go.
    ejected.lanternState = "dropped";
    if (!this.diedAt.has(sessionId)) {
      this.diedAt.set(sessionId, Date.now());
    }
    this.state.ejectedPlayerId = sessionId;
    this.state.ejectedPlayerName = ejected.name;
    this.state.ejectionConfirmed = confirmEjects;
    if (confirmEjects) {
      const ejectedRole = this.roles.get(sessionId);
      this.state.ejectedWasStranger =
        ejectedRole !== undefined && factionOf(ejectedRole) === FACTION.STRANGER;
    }
    if (!this.state.deadPlayerIds.includes(sessionId)) {
      this.state.deadPlayerIds.push(sessionId);
    }

    // Same wall move as a kill: the ejected player crosses into the graveyard
    // voice channel and out of the living one, peer connections and all.
    this.broadcastVoiceRosters();
  }

  /**
   * Decide who the ballot ejected: whoever has strictly the most votes. A skip
   * winning means nobody goes. A tie ejects nobody by default; with
   * `TIE_EJECTS_NOBODY` off it is broken at random instead.
   */
  private pickEjection(counts: Map<string, number>): string | null {
    let highest = 0;
    for (const count of counts.values()) {
      highest = Math.max(highest, count);
    }
    if (highest === 0) {
      return null;
    }

    const leaders = [...counts.entries()]
      .filter(([, count]) => count === highest)
      .map(([targetId]) => targetId);

    if (leaders.length > 1) {
      if (TIE_EJECTS_NOBODY) {
        return null;
      }
      const [choice] = pickRandom(leaders, 1);
      return choice === SKIP_VOTE ? null : (choice ?? null);
    }

    const winner = leaders[0]!;
    return winner === SKIP_VOTE ? null : winner;
  }

  /**
   * Close the meeting and hand the world back, with cooldowns reset — unless
   * the ejection just shown ended the game, in which case this is where that
   * takes effect instead. See `pendingGameOver`.
   */
  private endMeeting(): void {
    this.meetingTimer?.clear();
    this.meetingTimer = undefined;

    if (this.pendingGameOver) {
      const outcome = this.pendingGameOver;
      this.pendingGameOver = null;
      this.declareGameOver(outcome.faction, outcome.reason);
      return;
    }

    this.state.meetingStage = "";
    this.state.phase = PHASE.PLAYING;

    // A fresh ability cooldown for every living player who has one, so a
    // meeting can't be used to walk out of a cooldown. Each role re-arms at
    // its own configured duration (a zero-cooldown ability is ready again
    // immediately — its `uses` budget is what actually limits it). Roles
    // marked `usesPerRound` (Detective, Watchman, Medium) also get their
    // uses topped back up here — "once per round" means every round, not
    // just the first.
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      const role = this.roles.get(sessionId);
      const definition = role ? roleById(role) : undefined;
      if (!player.alive || !definition) {
        return;
      }
      for (const slot of definition.abilities) {
        const key = this.abilityKey(sessionId, slot.ability);
        const cooldownMs = this.cooldownFor(slot);
        this.abilityReadyAt.set(key, now + cooldownMs);
        if (slot.usesPerRound) {
          this.abilityUsesLeft.set(key, slot.uses);
        }
        this.sendAbilityState(sessionId, slot.ability, cooldownMs);
      }
    });

    // Back to open play: equal volume gives way to proximity again, and the
    // meeting's Silencer gag is lifted.
    this.broadcastVoiceRosters();
  }

  /**
   * Evaluate every win condition against the current state. Only ever called
   * from a kill, a task completion, or an ejection — see each call site's
   * comment for why the timing there is safe. Checked in this order:
   * townsfolk's positive conditions first (finishing tasks or clearing every
   * stranger), then the strangers' parity condition.
   *
   * `strangerDeparted` only ever changes how a town win is *described*: it
   * distinguishes the room hunting the last stranger down from the last
   * stranger simply walking out.
   */
  private evaluateWinCondition(
    strangerDeparted = false,
  ): { faction: Faction; reason: WinReason } | null {
    if (this.state.phase !== PHASE.PLAYING && this.state.phase !== PHASE.MEETING) {
      return null;
    }

    // Faction counts, not role counts — a doctor is townsfolk here, and a
    // future neutral would count on neither side of the parity ratio's
    // stranger half. (Neutral win conditions of their own are future work;
    // today a neutral simply survives to whichever ending the majors reach.)
    let aliveOthers = 0;
    let aliveStrangers = 0;
    this.state.players.forEach((player, id) => {
      if (!player.alive) {
        return;
      }
      const role = this.roles.get(id);
      if (role && factionOf(role) === FACTION.STRANGER) {
        aliveStrangers += 1;
      } else {
        aliveOthers += 1;
      }
    });

    if (this.state.taskBarTotal > 0 && this.state.taskBarCompleted >= this.state.taskBarTotal) {
      return { faction: FACTION.TOWNSFOLK, reason: WIN_REASON.TASKS };
    }
    // Every game deals at least one stranger (see `resolveRoleCounts` and
    // the last-stranger-role lock in `handleSetRoleEnabled`), and a stranger
    // can only ever die by ejection — the kill ability refuses same-faction
    // targets — or by leaving, so this is exactly "every stranger gone".
    if (aliveStrangers === 0) {
      return {
        faction: FACTION.TOWNSFOLK,
        reason: strangerDeparted ? WIN_REASON.STRANGERS_LEFT : WIN_REASON.STRANGERS_EJECTED,
      };
    }
    if (aliveStrangers >= aliveOthers) {
      return { faction: FACTION.STRANGER, reason: WIN_REASON.PARITY };
    }
    return null;
  }

  /** Evaluate and, if the game just ended, declare it immediately. */
  private checkWinConditionNow(): void {
    const outcome = this.evaluateWinCondition();
    if (outcome) {
      this.declareGameOver(outcome.faction, outcome.reason);
    }
  }

  /**
   * End the round: lock in the winner and reveal every true role. This is the
   * one deliberate point role information becomes public — everywhere else it
   * is a private, per-client message, never state.
   */
  private declareGameOver(faction: Faction, reason: WinReason): void {
    this.meetingTimer?.clear();
    this.meetingTimer = undefined;
    // A critical sabotage that's already resolved this way must not later
    // fire its own timeout and call back in here a second time. And if the
    // game ended some OTHER way (tasks finished) while one was still
    // counting down, it shouldn't leave a stale "still critical" flag behind
    // on the game-over screen.
    this.criticalSabotageTimer?.clear();
    this.criticalSabotageTimer = undefined;
    this.state.criticalSabotageActive = false;
    this.roundStore.clear();

    this.state.phase = PHASE.GAME_OVER;
    this.state.winningFaction = faction;
    this.state.winReason = reason;

    if (this.gameStartedAt > 0) {
      matchDurationSeconds.observe({ reason }, (Date.now() - this.gameStartedAt) / 1000);
    }
    this.log.info({ faction, reason }, "game over");

    // The round is over: voice goes quiet for everyone (the roster empties, so
    // every client tears its mesh down) rather than letting the dead and living
    // suddenly share the results screen over a live channel.
    this.broadcastVoiceRosters();

    // Read from `this.state.players` (the server's own copy, always
    // unfiltered) rather than anything a specific client received — a
    // living client's dead teammates were never in their copy to begin with.
    this.state.finalRoster.clear();
    this.state.players.forEach((player, id) => {
      const entry = new RevealedPlayer();
      entry.id = id;
      entry.name = player.name;
      entry.role = this.roles.get(id) ?? "";
      // Denormalised for the results screen's costumed pose preview — see
      // the doc on `RevealedPlayer.color`.
      entry.color = player.color;
      entry.hatId = player.hatId;
      entry.accessoryId = player.accessoryId;
      entry.petId = player.petId;
      entry.outfitId = player.outfitId;
      entry.victoryPoseId = player.victoryPoseId;
      entry.deathEffectId = player.deathEffectId;
      this.state.finalRoster.set(id, entry);
    });

    this.broadcastGameSummary();
    this.awardRoundCoins(faction);
    this.recordGameStats(faction);
  }

  /**
   * Broadcast the "who did what" breakdown behind the results screen: every
   * seated player's role, faction, survival, task progress, and this game's
   * full vote history. A live display, not a database write — everyone still
   * here gets a row, guest or account alike, unlike `recordGameStats` right
   * after it.
   */
  private broadcastGameSummary(): void {
    const players: GameSummaryMessage["players"] = [];
    this.state.players.forEach((player, id) => {
      const role = this.roles.get(id) ?? "";
      const progress = this.tasks.get(id);
      let tasksCompleted = 0;
      let tasksTotal = 0;
      progress?.forEach((task) => {
        tasksCompleted += task.completedSteps;
        tasksTotal += task.totalSteps;
      });
      players.push({
        id,
        name: player.name,
        role,
        faction: role ? factionOf(role) : "",
        survived: player.alive,
        tasksCompleted,
        tasksTotal,
      });
    });

    this.broadcast("gameSummary", { players, voteRounds: this.voteHistory } satisfies GameSummaryMessage);
  }

  /**
   * Batch-write this game's result into every seated account's lifetime
   * stats — one call, once per game, never touched per task or per kill (see
   * `StatsProvider.recordGameResults`'s own doc for why that matters).
   * Fire-and-forget for the same reason `awardRoundCoins` is: stats are a
   * profile-screen nicety, and a slow or failed write must never delay the
   * game-over transition every client is already waiting on. Guests are
   * skipped — there is no account for a stat line to attach to.
   */
  private recordGameStats(winningFaction: Faction): void {
    const provider = getStatsProvider();
    if (!provider) {
      return;
    }
    const entries: GameStatEntry[] = [];
    const gameEndedAt = Date.now();
    this.state.players.forEach((player, id) => {
      const userId = this.sessionUserIds.get(id);
      if (!userId) {
        return;
      }
      const role = this.roles.get(id);
      if (!role) {
        return;
      }
      const progress = this.tasks.get(id);
      let tasksCompleted = 0;
      progress?.forEach((task) => {
        tasksCompleted += task.completedSteps;
      });
      const diedAt = this.diedAt.get(id) ?? gameEndedAt;
      const survivalTimeMs = Math.max(0, diedAt - (this.gameStartedAt || diedAt));
      entries.push({
        userId,
        role,
        won: factionOf(role) === winningFaction,
        survived: player.alive,
        tasksCompleted,
        survivalTimeMs,
      });
    });
    void provider.recordGameResults(entries).catch(() => {
      // See above — a missed stat write costs one game's numbers, not a
      // broken game.
    });
  }

  /**
   * Pay every registered account still seated a flat amount for having
   * played the round out, plus a bonus for whoever ended up on the winning
   * faction. Guests earn nothing — they have no account for a coin balance
   * to attach to, the same reason they're excluded from friends and
   * moderation. Fire-and-forget for the same reason `applyCosmeticLoadout`
   * is: the economy is decorative, and a slow or failed award must never
   * delay the game-over transition every client is waiting on.
   */
  private awardRoundCoins(winningFaction: Faction): void {
    const provider = getCosmeticProvider();
    if (!provider) {
      return;
    }
    this.state.players.forEach((_player, id) => {
      const userId = this.sessionUserIds.get(id);
      if (!userId) {
        return;
      }
      const role = this.roles.get(id);
      const amount =
        COINS_PER_ROUND + (role && factionOf(role) === winningFaction ? COINS_WIN_BONUS : 0);
      void provider.awardCoins(userId, amount).catch(() => {
        // See above — a missed award is a lost 25 coins, not a broken game.
      });
    });
  }

  /**
   * Reset the room to a fresh lobby so the same players can start again.
   * Host-gated for the same reason `handleStart` is — this changes the room
   * for everyone, so it isn't every player's call to make.
   */
  private handleReturnToLobby(client: Client): void {
    if (this.state.phase !== PHASE.GAME_OVER) {
      return;
    }
    if (client.sessionId !== this.state.hostId) {
      return;
    }

    this.meetingTimer?.clear();
    this.meetingTimer = undefined;
    this.criticalSabotageTimer?.clear();
    this.criticalSabotageTimer = undefined;

    this.roles.clear();
    this.tasks.clear();
    this.abilityReadyAt.clear();
    this.abilityUsesLeft.clear();
    this.roundStore.clear();
    this.deathLocations.clear();
    this.mediumRevealed.clear();
    this.roomPresence.clear();
    this.emergencyMeetingsUsed.clear();
    this.votes.clear();
    this.lastChatAt.clear();
    this.disguises.clear();
    this.pendingSilences.clear();
    this.silencedThisMeeting.clear();
    // Mutes are per-round, like everything else here: "play again" starts
    // everyone on a clean slate. Anything that should have followed the player
    // into the next round belonged in a ban, not a mute.
    this.mutedUntil.clear();
    this.muteVotes.clear();
    this.lastChatText.clear();
    this.blockedMessageCount.clear();
    this.pendingLockCounts.clear();
    this.pendingSabotageCount = 0;
    this.criticalSabotageEndsAt = 0;
    this.pendingGameOver = null;
    this.gameStartedAt = 0;
    this.diedAt.clear();
    this.voteHistory.length = 0;
    // Role settings AND balance settings (`state.settings`) deliberately
    // survive the reset — the host tuned them for this lobby, and "play
    // again" should mean the same game.

    this.state.phase = PHASE.LOBBY;
    this.state.sabotageActive = false;
    this.state.lockedRoomSlugs.clear();
    this.state.commsSabotageActive = false;
    this.state.criticalSabotageActive = false;
    this.state.criticalRepairedPoints.clear();
    this.state.lampLit = false;
    this.state.meetingStage = "";
    this.state.meetingReporterId = "";
    this.state.meetingBodyId = "";
    this.state.meetingBodyName = "";
    this.state.meetingBodyRoom = "";
    this.state.meetingIsEmergency = false;
    this.state.deadPlayerIds.clear();
    this.state.voteResults.clear();
    this.state.ejectedPlayerId = "";
    this.state.ejectedPlayerName = "";
    this.state.ejectedWasStranger = false;
    this.state.ejectionConfirmed = false;
    this.state.taskBarCompleted = 0;
    this.state.taskBarTotal = 0;
    this.state.winningFaction = "";
    this.state.winReason = "";
    this.state.finalRoster.clear();
    this.clearRealBodies();

    this.state.players.forEach((player) => {
      player.alive = true;
      player.lanternState = "lit"; // relit for the new round — see `killPlayer`'s doc
      player.hasVoted = false;
      const spawn = randomSpawn();
      player.x = spawn.x;
      player.y = spawn.y;
    });

    // Voice is inactive in the lobby, so an empty roster goes out and every
    // client tears its mesh down. `voiceReady` itself is deliberately kept:
    // a player who had voice on stays opted in, and the next round's phase
    // change rebuilds the mesh for them with no second click.
    this.broadcastVoiceRosters();

    // `onAuth` starts letting new players in again on its own, now that the
    // phase is back to LOBBY — there is no lock to release.
  }

  /**
   * Relay a chat line to the channel the sender belongs to.
   *
   * This is the whole of the living/dead split: the message is delivered with
   * `client.send` to a list filtered by liveness, so a living player's socket
   * never carries a dead player's words at all. Hiding dead chat in the UI
   * instead would leave it sitting in every living client's network traffic.
   */
  private handleChat(client: Client, message: unknown): void {
    const sender = this.state.players.get(client.sessionId);
    if (!sender) {
      return;
    }

    // The living only talk during meetings. The dead have nothing else to do,
    // so their channel stays open the whole game.
    if (sender.alive && this.state.phase !== PHASE.MEETING) {
      return;
    }

    // The Silencer's gag — living chat only; the dead were never its target.
    if (sender.alive && this.silencedThisMeeting.has(client.sessionId)) {
      return;
    }

    const now = Date.now();

    // A mute — host-issued, vote-carried or automatic — silences all three
    // channels at once. Checked before the cooldown so the sender is told
    // *why* they are not being heard rather than being ignored silently.
    const mutedUntil = this.mutedUntil.get(client.sessionId) ?? 0;
    if (mutedUntil > now) {
      client.send("chatRejected", { reason: "muted", mutedUntil });
      return;
    }

    const last = this.lastChatAt.get(client.sessionId) ?? 0;
    if (now - last < CHAT_COOLDOWN_MS) {
      return;
    }

    const raw = (message ?? {}) as { text?: unknown };
    const text = typeof raw.text === "string" ? raw.text.trim().slice(0, MAX_CHAT_LENGTH) : "";
    if (!text) {
      return;
    }

    // Burst budget on top of the per-message gap: the cooldown alone only
    // stops someone holding the key down, not a script pacing itself just
    // above it. Tripping this is what spam actually looks like, so it earns
    // the automatic mute rather than a silent drop.
    if (!this.chatBurst.check(client.sessionId, now).allowed) {
      this.applyMute(client.sessionId, SPAM_MUTE_MS, now);
      client.send("chatRejected", { reason: "rate_limited", mutedUntil: now + SPAM_MUTE_MS });
      logAntiCheatEvent(this.log, "chat_rate_limit", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { kind: "burst" },
      });
      return;
    }

    // The same line over and over is the other shape flooding takes, and one
    // the burst budget alone permits indefinitely at a slow enough pace.
    const repeat = this.lastChatText.get(client.sessionId);
    const repeatCount = repeat && repeat.text === text ? repeat.count + 1 : 1;
    this.lastChatText.set(client.sessionId, { text, count: repeatCount });
    if (repeatCount > CHAT_REPEAT_MAX) {
      this.applyMute(client.sessionId, SPAM_MUTE_MS, now);
      client.send("chatRejected", { reason: "rate_limited", mutedUntil: now + SPAM_MUTE_MS });
      logAntiCheatEvent(this.log, "chat_rate_limit", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { kind: "repeat", repeatCount },
      });
      return;
    }

    // The filter. Ordinary profanity is masked and still delivered; slurs and
    // targeted harassment are refused outright, and enough of them earns the
    // same automatic mute as flooding does.
    const screened = screenText(text);
    if (screened.verdict === "blocked") {
      const strikes = (this.blockedMessageCount.get(client.sessionId) ?? 0) + 1;
      this.blockedMessageCount.set(client.sessionId, strikes);
      if (strikes >= BLOCKED_MESSAGE_MUTE_THRESHOLD) {
        this.applyMute(client.sessionId, SPAM_MUTE_MS, now);
      }
      logAntiCheatEvent(this.log, "chat_profanity", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
        detail: { strikes },
      });
      client.send("chatRejected", { reason: "blocked" });
      // Recorded even though it was never delivered: a refused slur is
      // precisely the evidence a moderator reviewing a report wants to see.
      this.recordChatLog(client.sessionId, sender.name, CHAT_CHANNEL.LIVING, text, true);
      return;
    }

    this.lastChatAt.set(client.sessionId, now);

    const channel: ChatChannel = sender.alive ? CHAT_CHANNEL.LIVING : CHAT_CHANNEL.DEAD;
    const payload = {
      id: `${client.sessionId}-${now}`,
      channel,
      senderName: sender.name,
      text: screened.text,
    };

    this.recordChatLog(
      client.sessionId,
      sender.name,
      channel,
      screened.text,
      screened.verdict !== "clean",
    );

    for (const recipient of this.clients) {
      const recipientPlayer = this.state.players.get(recipient.sessionId);
      if (!recipientPlayer) {
        continue;
      }
      // The one line that enforces the split.
      if (recipientPlayer.alive !== sender.alive) {
        continue;
      }
      recipient.send("chat", payload);
    }
  }

  /**
   * Silence a session for `durationMs`, extending rather than replacing an
   * existing mute — a spammer who trips the limiter again mid-mute should not
   * have their remaining time reset downwards by a shorter new one.
   */
  private applyMute(sessionId: string, durationMs: number, now = Date.now()): void {
    const existing = this.mutedUntil.get(sessionId) ?? 0;
    this.mutedUntil.set(sessionId, Math.max(existing, now + durationMs));
  }

  /**
   * Keep a line for report evidence and hand it to the moderation store.
   *
   * The in-memory `recentChat` ring is what a report snapshots at filing time;
   * the provider call is the durable, retention-swept copy. Fire-and-forget on
   * purpose — chat is on the room's hot path and must not wait on a database
   * write, and a lost log line is not worth stalling a meeting over.
   */
  private recordChatLog(
    sessionId: string,
    senderName: string,
    channel: string,
    text: string,
    filtered: boolean,
  ): void {
    const sentAt = new Date();
    this.recentChat.push({ senderName, text, sentAt: sentAt.toISOString() });
    if (this.recentChat.length > REPORT_CHAT_EXCERPT_LINES) {
      this.recentChat.shift();
    }

    const provider = getModerationProvider();
    if (!provider) {
      return;
    }
    void provider
      .appendChatLog({
        roomCode: this.roomId,
        userId: this.sessionUserIds.get(sessionId) ?? null,
        senderName,
        channel,
        text,
        filtered,
        sentAt,
      })
      .catch(() => {
        // See above: logging is best-effort and never blocks play.
      });
  }

  /**
   * File a report against another player.
   *
   * The reported player must hold an account — a guest has no durable identity
   * for a moderator to act on, so reporting one would only fill the queue with
   * items nobody can resolve. The *reporter* may be a guest; their report is
   * still worth having, and the rate limit is per session either way.
   */
  private async handleReport(client: Client, message: unknown): Promise<void> {
    const reporter = this.state.players.get(client.sessionId);
    if (!reporter) {
      return;
    }

    const raw = (message ?? {}) as { targetId?: unknown; reason?: unknown; note?: unknown };
    const targetId = typeof raw.targetId === "string" ? raw.targetId : "";
    if (!isReportReason(raw.reason) || !targetId || targetId === client.sessionId) {
      client.send("reportAck", { ok: false, error: "invalid" });
      return;
    }

    // Resolve the target's name from whichever roster still knows it. A player
    // reported from the results screen is often dead, and the living client's
    // `players` map has been filtered clear of them — `finalRoster` is the
    // only place their name survives. See `GameState.finalRoster`.
    const targetName =
      this.state.players.get(targetId)?.name ?? this.state.finalRoster.get(targetId)?.name ?? "";
    const targetUserId = this.sessionUserIds.get(targetId);
    if (!targetUserId || !targetName) {
      client.send("reportAck", { ok: false, error: "invalid" });
      return;
    }

    if (!this.reportLimiter.check(client.sessionId).allowed) {
      client.send("reportAck", { ok: false, error: "rate_limited" });
      logAntiCheatEvent(this.log, "report_rate_limit", {
        sessionId: client.sessionId,
        userId: this.sessionUserIds.get(client.sessionId) ?? null,
      });
      return;
    }

    const provider = getModerationProvider();
    if (!provider) {
      client.send("reportAck", { ok: false, error: "unavailable" });
      return;
    }

    const note =
      typeof raw.note === "string" ? raw.note.trim().slice(0, REPORT_NOTE_MAX_LENGTH) || null : null;

    try {
      await provider.fileReport({
        reporterId: this.sessionUserIds.get(client.sessionId) ?? null,
        reporterName: reporter.name,
        reportedId: targetUserId,
        reportedName: targetName,
        reason: raw.reason,
        note,
        roomCode: this.roomId,
        // Snapshotted here rather than looked up later: `ChatLog` rows are
        // deleted on a retention schedule, and a report's evidence has to
        // outlive that sweep.
        chatExcerpt: [...this.recentChat],
      });
      client.send("reportAck", { ok: true });
    } catch {
      client.send("reportAck", { ok: false, error: "unavailable" });
    }
  }

  /**
   * The host silencing someone for the rest of the round. Authoritative and
   * host-only, the same as every other host power here — the client only ever
   * asks. The host cannot mute themselves, which would otherwise be a way to
   * lock a room's chat by accident.
   */
  private handleHostMute(client: Client, message: unknown): void {
    if (client.sessionId !== this.state.hostId) {
      return;
    }
    const raw = (message ?? {}) as { targetId?: unknown; muted?: unknown };
    const targetId = typeof raw.targetId === "string" ? raw.targetId : "";
    if (!targetId || targetId === client.sessionId || !this.state.players.has(targetId)) {
      return;
    }

    if (raw.muted === false) {
      this.mutedUntil.delete(targetId);
      this.muteVotes.delete(targetId);
      return;
    }
    // Long enough to outlast the round; a mute never survives the room.
    this.applyMute(targetId, VOTE_MUTE_MS);
  }

  /**
   * A player voting to mute someone. Carries once a majority of the *other*
   * connected players agree, which is what keeps it from being a griefing tool
   * in a small room while still working against a genuine nuisance in a full
   * one — hence the `VOTE_MUTE_MIN_PLAYERS` floor too.
   *
   * Host-disablable via the `voteMuteEnabled` balance setting.
   */
  private handleVoteMute(client: Client, message: unknown): void {
    if (!this.getBooleanSetting("voteMuteEnabled")) {
      return;
    }
    const voter = this.state.players.get(client.sessionId);
    if (!voter) {
      return;
    }
    const raw = (message ?? {}) as { targetId?: unknown };
    const targetId = typeof raw.targetId === "string" ? raw.targetId : "";
    if (!targetId || targetId === client.sessionId || !this.state.players.has(targetId)) {
      return;
    }
    // The host is exempt: they already hold `mute`, and letting a lobby
    // vote-mute its own host is a griefing vector with no upside.
    if (targetId === this.state.hostId) {
      return;
    }

    let connected = 0;
    this.state.players.forEach((player) => {
      if (player.connected) {
        connected += 1;
      }
    });
    if (connected < VOTE_MUTE_MIN_PLAYERS) {
      return;
    }

    let ballots = this.muteVotes.get(targetId);
    if (!ballots) {
      ballots = new Set();
      this.muteVotes.set(targetId, ballots);
    }
    ballots.add(client.sessionId);

    // Everyone except the target gets a say, so the threshold is a majority of
    // the room minus them.
    const electorate = Math.max(1, connected - 1);
    if (ballots.size / electorate > VOTE_MUTE_SHARE) {
      this.applyMute(targetId, VOTE_MUTE_MS);
      this.muteVotes.delete(targetId);
      this.broadcast("playerMuted", { targetId, until: this.mutedUntil.get(targetId) });
    }
  }

  /**
   * Accept an input command. Everything here is treated as hostile: the
   * sequence number is coerced to an integer and the direction is reduced to a
   * canonical -1/0/1 intent. Any position-like fields the client may include
   * are ignored entirely — position is derived on the server, never received.
   */
  private enqueueInput(client: Client, message: unknown): void {
    // Movement is locked during a meeting or once the game has ended. This is
    // intentionally narrower than "only while playing" — inputs have always
    // been accepted before the world even opens, and that pre-existing
    // behaviour isn't this change's concern.
    if (this.state.phase === PHASE.MEETING || this.state.phase === PHASE.GAME_OVER) {
      return;
    }

    const state = this.inputs.get(client.sessionId);
    if (!state) {
      return;
    }

    const raw = (message ?? {}) as { seq?: unknown; dir?: { x?: unknown; y?: unknown } };
    const seq = Number(raw.seq);
    if (!Number.isFinite(seq)) {
      return;
    }

    const dir = sanitizeDirection(raw.dir?.x, raw.dir?.y);
    state.queue.push({ seq: Math.trunc(seq), dir });

    if (state.queue.length > MAX_QUEUED_INPUTS) {
      state.queue.splice(0, state.queue.length - MAX_QUEUED_INPUTS);
    }
  }

  // --- Proximity voice -----------------------------------------------------
  //
  // The server is the mesh's signalling relay AND its access control. Clients
  // do the WebRTC and the audio; the server decides who is even *allowed* to
  // connect to whom, and refuses to carry a signalling message across that
  // line. That is the whole of the dead/living voice wall: not a mute, not a
  // silence — the peer connection is never negotiated, exactly as
  // `GameState.players` never puts a dead player's position on a living wire.

  /**
   * Whether voice is live at all. Only during open play and meetings — there
   * is nothing to say to each other on the reveal screen, the lobby, or the
   * game-over results, and keeping the mesh torn down outside these phases is
   * what makes "voice off" the default the client falls back to.
   */
  private isVoiceActive(): boolean {
    return this.state.phase === PHASE.PLAYING || this.state.phase === PHASE.MEETING;
  }

  /**
   * Whether `id` counts as "alive" for voice-ROSTER-SHAPE purposes — real
   * liveness, OR a covert kill still in its undisclosed window. This is
   * deliberately NOT the same question `player.alive` answers: that flag
   * governs the game (fog, movement, the actual living/dead split everywhere
   * else), and flips the instant a kill lands, full stop. This method answers
   * a narrower one — "should `voicePeersFor` still list this player as a live
   * conversational peer" — so a covertly killed player can go on appearing in
   * their former living peers' rosters, unheard from (see `deathMuted` in
   * `sendVoiceRoster`), until the death is disclosed.
   */
  private isVoiceAlive(player: Player, id: string): boolean {
    return player.alive || this.undisclosedKills.has(id);
  }

  /**
   * THE authoritative peer set for one client: everyone they are allowed to
   * hold a voice connection with right now. This single function is the wall —
   * every other piece of the voice system (the roster it pushes, the
   * signalling it relays) is derived from it, so there is exactly one place the
   * living/dead separation is decided.
   *
   * The rules mirror the chat channels precisely: voice must be active; both
   * players present and connected; both opted into voice; and — the line that
   * matters — a (voice-)living player and a (voice-)dead player are never in
   * each other's set. Note "voice-alive" rather than `.alive` directly: a
   * living client's roster keeps listing a covertly killed former peer for as
   * long as that kill stays undisclosed (see `isVoiceAlive`), which is the
   * whole point — the roster's SHAPE must not change on a kill nobody has
   * found out about yet. Their mic is dead regardless; that is enforced by
   * `deathMuted`, not by removing them here.
   */
  private voicePeersFor(sessionId: string): string[] {
    if (!this.isVoiceActive() || !this.voiceReady.has(sessionId)) {
      return [];
    }
    const self = this.state.players.get(sessionId);
    if (!self || !self.connected) {
      return [];
    }
    const selfVoiceAlive = this.isVoiceAlive(self, sessionId);
    const peers: string[] = [];
    this.state.players.forEach((other, id) => {
      if (id === sessionId || !other.connected || !this.voiceReady.has(id)) {
        return;
      }
      // The wall, in voice-alive terms — see this method's own doc.
      if (this.isVoiceAlive(other, id) !== selfVoiceAlive) {
        return;
      }
      peers.push(id);
    });
    return peers;
  }

  /**
   * Push one client its current voice roster — who to connect to, how to weight
   * volume this phase, and whether the Silencer has gagged them. The client
   * reconciles its live peer connections against `peers`, opening the new ones
   * and tearing down any that dropped off.
   */
  private sendVoiceRoster(client: Client): void {
    const self = this.state.players.get(client.sessionId);
    const roster: VoiceRosterMessage = {
      peers: this.voicePeersFor(client.sessionId),
      mode: this.state.phase === PHASE.MEETING ? VOICE_MODE.EQUAL : VOICE_MODE.PROXIMITY,
      channel: self && !self.alive ? VOICE_CHANNEL.DEAD : VOICE_CHANNEL.LIVING,
      // Only meaningful during a meeting; a gagged player disables their own
      // mic. Kept private to the gagged client (not the whole silenced set) so
      // being silenced stays as unobservable to others as it is in chat.
      selfSilenced:
        this.state.phase === PHASE.MEETING &&
        self !== undefined &&
        self.alive &&
        this.silencedThisMeeting.has(client.sessionId),
      // The real `alive` flag, not `isVoiceAlive` — this is what actually
      // silences a covert-kill victim from the instant they die, independent
      // of how long their roster entry lingers elsewhere as cover. Bounded to
      // the undisclosed window: once disclosed, `undisclosedKills` no longer
      // contains them and this goes false, because by then their `peers` is
      // the real ghost roster and there is nothing left to protect against.
      deathMuted:
        self !== undefined && !self.alive && this.undisclosedKills.has(client.sessionId),
    };

    // Skip the send entirely if nothing in it actually changed for this
    // client — see `lastSentVoiceRoster`'s own doc for why this is a
    // security property here, not just an optimisation.
    const signature = JSON.stringify(roster);
    if (this.lastSentVoiceRoster.get(client.sessionId) === signature) {
      return;
    }
    this.lastSentVoiceRoster.set(client.sessionId, signature);
    client.send("voiceRoster", roster);
  }

  /**
   * Re-push the roster to every client whose voice is on. Called after anything
   * that can move the wall — a death, an ejection, a phase change, a peer
   * enabling or dropping voice — because a stale roster is how a living client
   * would keep a connection open to someone who just died.
   */
  private broadcastVoiceRosters(): void {
    this.clients.forEach((client) => {
      if (this.voiceReady.has(client.sessionId)) {
        this.sendVoiceRoster(client);
      }
    });
  }

  /**
   * A client is turning voice on: hand it the ICE servers (freshly minted TURN
   * credentials included), register it, and tell everyone — the newcomer gets
   * its roster, and existing voice peers get theirs updated to include it, so
   * both ends open the connection together.
   */
  private handleVoiceReady(client: Client): void {
    client.send("voiceConfig", { iceServers: buildIceServers() });
    this.voiceReady.add(client.sessionId);
    this.broadcastVoiceRosters();
  }

  /** A client is turning voice off: deregister it and update everyone's roster so peers tear the connection down. */
  private handleVoiceStop(client: Client): void {
    if (this.voiceReady.delete(client.sessionId)) {
      this.broadcastVoiceRosters();
    }
  }

  /**
   * Relay one WebRTC signalling message between two peers — the mesh's only
   * path to the outside, and the enforcement point for the wall. The message is
   * forwarded ONLY if the sender is currently allowed to reach the target
   * (`voicePeersFor` includes it). A signal aimed across the living/dead line
   * is dropped on the floor: no offer arrives, so no connection is ever
   * negotiated, let alone established. `voicePeersFor` is symmetric, so a valid
   * pair can signal both ways; nothing else can signal at all.
   */
  private relayVoiceSignal(client: Client, message: unknown): void {
    if (!this.isVoiceActive()) {
      return;
    }
    const raw = (message ?? {}) as VoiceSignalMessage;
    const to = typeof raw.to === "string" ? raw.to : undefined;
    if (!to) {
      return;
    }
    if (!this.voicePeersFor(client.sessionId).includes(to)) {
      return;
    }
    const target = this.clientFor(to);
    if (!target) {
      return;
    }
    const payload: VoiceSignalMessage = {
      from: client.sessionId,
      description: raw.description,
      candidate: raw.candidate,
    };
    target.send("voice_signal", payload);
  }

  /**
   * Authoritative tick: advance every player's position from their queued
   * inputs. A token budget that refills at the legitimate input rate caps how
   * many commands are processed per second, so flooding inputs cannot buy extra
   * speed. Positions are clamped to the map inside `applyInput`.
   */
  private update(): void {
    if (this.state.phase === PHASE.MEETING || this.state.phase === PHASE.GAME_OVER) {
      return;
    }

    // Snapshot once per tick rather than re-reading the schema array per
    // player — cheap either way (0-9 room slugs), but there is no reason to
    // redo it inside the loop below.
    const lockedRoomSlugs: string[] = [];
    this.state.lockedRoomSlugs.forEach((slug) => lockedRoomSlugs.push(slug));

    this.state.players.forEach((player, sessionId) => {
      const state = this.inputs.get(sessionId);
      if (!state) {
        return;
      }

      state.budget = Math.min(MAX_INPUT_BUDGET, state.budget + INPUT_RATE / TICK_RATE);

      const steps = Math.min(state.queue.length, Math.floor(state.budget));
      if (steps <= 0) {
        return;
      }
      state.budget -= steps;

      let pos = { x: player.x, y: player.y };
      let lastSeq = player.lastSeq;
      for (let i = 0; i < steps; i++) {
        const command = state.queue[i]!;
        pos = applyInputWithLocks(pos, command.dir, SIM_DT, lockedRoomSlugs);
        lastSeq = command.seq;
      }
      state.queue.splice(0, steps);

      player.x = pos.x;
      player.y = pos.y;
      player.lastSeq = lastSeq;
    });

    // The fog heartbeat. Colyseus only re-evaluates a `@filterChildren`
    // callback for a MapSchema entry that has a pending change THIS patch
    // (confirmed directly against @colyseus/schema's `applyFilters`: a
    // client-already-known entity is only re-filtered when it appears in
    // that patch's `changeTree.changes`, never on a bare "time passed" or
    // "some other entity moved" basis) — so without this, a player who
    // stands still would never be re-checked as others walk toward or away
    // from them, and their visibility would freeze along with them.
    //
    // This applies EQUALLY to bodies, even though a body's x/y never
    // actually changes after it's created (a pre-launch audit flagged the
    // body half of this as "provably static, so surely safe to drop" —
    // that reasoning is wrong: a body's *position* is static, but its
    // *visibility* to a given client is a function of that client's own
    // position, which keeps changing. Without re-dirtying it, a corpse that
    // existed before a player entered its fog radius would never be
    // (re-)filtered for that player and would simply never appear, no
    // matter how close they walk — dropping this is a correctness bug, not
    // an optimization, and was verified against the actual encoder source
    // before deciding to leave it as-is here.
    //
    // Marking every position dirty each tick forces the fog filter to
    // re-run for every player/viewer pair every patch. It also doubles as
    // the client's liveness signal: anyone a client is entitled to see
    // updates every patch, so an entity that has gone quiet is, by
    // elimination, hidden — which is how `GameScene` knows to stop drawing
    // them without ever being told.
    if (this.state.phase === PHASE.PLAYING) {
      this.state.players.forEach((player) => {
        player.setDirty("x");
        player.setDirty("y");
      });
      this.state.bodies.forEach((body) => {
        body.setDirty("x");
        body.setDirty("y");
      });

      this.updateRoomPresenceAndCameras();
    }
  }

  /**
   * Detective and Watchman tracking, one tick at a time: record every living
   * player's current room (the detective's raw material — see
   * `findWitness`), and feed any active watchman camera whose room matches.
   * A sabotage blinds every camera it catches mid-tick instead of feeding it,
   * and that blindness is sticky for the rest of the round: once a camera has
   * missed a tick to sabotage, its feed stays dark rather than opportunistically
   * resuming the instant the sabotage ends. Without that, a camera could
   * legitimately relearn a sighting seconds after the blackout — nothing was
   * ever un-recorded, but it would read to the watchman as if the sabotage
   * hadn't happened at all. `startMeeting`'s reveal reports the whole thing as
   * `blinded`.
   */
  private updateRoomPresenceAndCameras(): void {
    const now = Date.now();
    const activeCameras = cameras(this.roundStore);

    this.state.players.forEach((player, sessionId) => {
      if (!player.alive) {
        return;
      }
      const room = roomSlugAt(player.x, player.y);

      let seen = this.roomPresence.get(room);
      if (!seen) {
        seen = new Map<string, number>();
        this.roomPresence.set(room, seen);
      }
      seen.set(sessionId, now);

      activeCameras.forEach((camera, ownerId) => {
        if (camera.roomSlug !== room || ownerId === sessionId) {
          return;
        }
        if (this.state.sabotageActive || camera.blinded) {
          camera.blinded = true;
          return;
        }
        camera.sightings.add(sessionId);
      });
    });
  }

  /** Choose a colour not already in use, falling back to the cycle if all taken. */
  private pickColor(): string {
    const used = new Set<string>();
    this.state.players.forEach((p) => used.add(p.color));

    const free = PLAYER_COLORS.find((c) => !used.has(c));
    if (free) {
      return free;
    }

    const index = this.state.players.size % PLAYER_COLORS.length;
    return PLAYER_COLORS[index] ?? PLAYER_COLORS[0];
  }

  /**
   * The §3.5 identity light — unlike `pickColor` above, this never needs a
   * wrap-around fallback: `MAX_PLAYERS` is defined as exactly
   * `lanternColors.length` (see that constant's own doc), so a free lantern
   * colour is guaranteed to exist for every seat the room can ever hold. The
   * `?? lanternColors[0]` is defensive only — it should be unreachable.
   */
  private pickLanternColor(): string {
    const used = new Set<string>();
    this.state.players.forEach((p) => used.add(p.lanternColor));
    const free = lanternColors.find((c) => !used.has(c.hex));
    return (free ?? lanternColors[0]).hex;
  }
}
