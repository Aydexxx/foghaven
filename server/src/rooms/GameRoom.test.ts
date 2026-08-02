import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  BELL_RANGE,
  CHAT_CHANNEL,
  type ChatMessage,
  type ClientTask,
  CONFIRM_EJECTS,
  EMERGENCY_MEETINGS_PER_PLAYER,
  MEETING_STAGE,
  SKIP_VOTE,
  TIE_EJECTS_NOBODY,
  VOTES_ARE_CHANGEABLE,
  VOTES_ARE_PUBLIC,
  GHOSTS_CAN_DO_TASKS,
  INPUT_RATE,
  JOIN_ERROR,
  MAX_PLAYERS,
  KILL_COOLDOWN_MS,
  KILL_INITIAL_DELAY_MS,
  KILL_RANGE,
  LAMP_DURATION_MS,
  type KilledMessage,
  type AbilityStateMessage,
  FACTION,
  factionOf,
  PRESET,
  PRESET_CUSTOM,
  presetRoleIds,
  resolveRoleCounts,
  strangerFactionCount,
  MAP,
  MAX_CHAT_LENGTH,
  MEETING_SPAWN_RADIUS,
  MIN_PLAYERS,
  PHASE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RANDOM_TASKS_PER_PLAYER,
  REPORT_BODY_RANGE,
  roomSlugAt,
  ROLES,
  ROLE_REVEAL_MS,
  type RoleAssignment,
  SIM_DT,
  TASK_DEFINITIONS,
  TASK_DEFINITIONS_BY_ID,
  TASK_INTERACT_RADIUS,
  TASK_ROOM_ANCHOR,
  type TaskProgressMessage,
  type TasksMessage,
  TICK_RATE,
  TOWN_HALL,
  WIN_REASON,
  SABOTAGE_DURATION_MS,
  ADVANCED_SABOTAGE_DURATION_MS,
  TUNNEL_ENDPOINTS,
  CRITICAL_REPAIR_POINTS,
  SETTING_DEFINITIONS,
  settingById,
  LOBBY_READY_PAD_POINT,
  LOBBY_SPAWN_ZONE,
  SPAWN_ZONE,
  TILE_SIZE,
  isOnReadyPad,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import { Body, PADDING_BODY_ID } from "./schema/GameState";
import type { GameState, Player } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/** Distance a single legitimate input command is allowed to move a player. */
const STEP = PLAYER_SPEED * SIM_DT;

/**
 * `room.state.bodies` permanently holds one extra entry (`PADDING_BODY_ID`,
 * seeded in `onCreate`, never removed — see that field's own doc for the
 * packet-size leak it closes). Every test that used to assert a real body
 * count against the raw `.size` goes through this instead, so the assertion
 * still reads as "how many actual corpses" rather than every call site
 * silently baking in a +1 that has nothing to do with what the test is
 * checking.
 */
function realBodyCount(room: ServerRoom<GameState>): number {
  return room.state.bodies.size - (room.state.bodies.has(PADDING_BODY_ID) ? 1 : 0);
}

let colyseus: ColyseusTestServer;

/**
 * The room's `onAuth` now runs through the account provider, so the suite
 * installs an in-memory one — no database. A tokenless connect (which is what
 * every existing `seat()` / `connectTo({ name })` does) resolves to a guest,
 * so all the pre-account tests keep working unchanged; the account-specific
 * tests below seed users and pass tokens explicitly.
 */
let authProvider: InMemoryAuthProvider;

/**
 * Backs `onAuth`'s block check (see `GameRoom.onAuth`'s "avoid matching them
 * where possible" comment) — installed for the same no-database reason
 * `authProvider` is. Most tests never touch it; the block-specific tests
 * below seed it directly via `seedBlock`/`seedFriendship`.
 */
let friendProvider: InMemoryFriendProvider;

beforeAll(async () => {
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  const gameServer = new Server({ transport: new WebSocketTransport({}) });
  gameServer.define("game", GameRoom);

  // Port 0 binds an OS-assigned ephemeral port. `@colyseus/testing`'s
  // `boot()` hardcodes port 2568 whenever it's handed a `Server` instance
  // (its `port` argument is only honoured for its other, config-object
  // overload), so a killed run's zombie process permanently EADDRINUSEs
  // every later run. Listen directly instead, then read back the real port
  // for `ColyseusTestServer`, which needs it to build the client's URL.
  await gameServer.listen(0);
  const address = (gameServer.transport.server as import("net").Server).address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  (gameServer as unknown as { port: number }).port = port;

  colyseus = new ColyseusTestServer(gameServer);
});

afterAll(async () => {
  // beforeAll may have thrown before `colyseus` was assigned; shutting down
  // an undefined server would mask that original failure behind a confusing
  // "Cannot read properties of undefined (reading 'shutdown')".
  if (colyseus) {
    await colyseus.shutdown();
  }
  setAuthProvider(null);
  setFriendProvider(null);
});

afterEach(async () => {
  await colyseus.cleanup();
  authProvider.reset();
  friendProvider.reset();
});

/**
 * Wait for `count` authoritative ticks to elapse. Sleeping on wall-clock time
 * rather than the room's tick callback keeps this independent of how many ticks
 * the server actually scheduled, so assertions stay about the outcome.
 */
function tick(count: number): Promise<void> {
  const ms = (1000 / TICK_RATE) * count + 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let seatCount = 0;

/**
 * Join a room with the player parked at a known position, so assertions do not
 * depend on the random spawn point or run into the map bounds. Every private
 * "role" message the client receives is captured, which is what lets the leak
 * tests below inspect exactly what each individual player was told.
 */
async function seat(
  room: ServerRoom<GameState>,
  options: { at?: { x: number; y: number }; name?: string } = {},
) {
  const name = options.name ?? `Tester${++seatCount}`;
  const client = await colyseus.connectTo(room, { name });
  const player = room.state.players.get(client.sessionId)!;

  const at = options.at ?? { x: MAP.width / 2, y: MAP.height / 2 };
  player.x = at.x;
  player.y = at.y;

  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (message: RoleAssignment) => roleMessages.push(message));

  const taskMessages: TasksMessage[] = [];
  client.onMessage("tasks", (message: TasksMessage) => taskMessages.push(message));

  const taskProgressMessages: TaskProgressMessage[] = [];
  client.onMessage("taskProgress", (message: TaskProgressMessage) =>
    taskProgressMessages.push(message),
  );

  const abilityStateMessages: AbilityStateMessage[] = [];
  client.onMessage("abilityState", (message: AbilityStateMessage) => abilityStateMessages.push(message));

  const killedMessages: KilledMessage[] = [];
  client.onMessage("killed", (message: KilledMessage) => killedMessages.push(message));

  let killConfirmedCount = 0;
  client.onMessage("killConfirmed", () => {
    killConfirmedCount += 1;
  });

  const chatMessages: ChatMessage[] = [];
  client.onMessage("chat", (message: ChatMessage) => chatMessages.push(message));

  const investigateHints: Array<{ witnessName: string | null; apparentFaction: string | null }> =
    [];
  client.onMessage(
    "investigateHint",
    (message: { witnessName: string | null; apparentFaction: string | null }) =>
      investigateHints.push(message),
  );

  const communeHints: Array<{ name: string; room: string; killerFaction: string | null } | null> =
    [];
  client.onMessage(
    "communeHint",
    (message: { name: string; room: string; killerFaction: string | null } | null) =>
      communeHints.push(message),
  );

  const cameraReveals: Array<{ roomSlug: string; names: string[]; blinded: boolean }> = [];
  client.onMessage(
    "cameraReveal",
    (message: { roomSlug: string; names: string[]; blinded: boolean }) =>
      cameraReveals.push(message),
  );

  const abilityEffects: Array<{ type: string; targetId: string }> = [];
  client.onMessage("abilityEffect", (message: { type: string; targetId: string }) =>
    abilityEffects.push(message),
  );

  const tunnelSoundMessages: Array<{ points: Array<{ x: number; y: number }> }> = [];
  client.onMessage(
    "tunnelSound",
    (message: { points: Array<{ x: number; y: number }> }) =>
      tunnelSoundMessages.push(message),
  );

  let silencedCount = 0;
  client.onMessage("silenced", () => {
    silencedCount += 1;
  });

  return {
    client,
    player,
    name,
    roleMessages,
    taskMessages,
    taskProgressMessages,
    abilityStateMessages,
    killedMessages,
    get killConfirmedCount() {
      return killConfirmedCount;
    },
    chatMessages,
    investigateHints,
    communeHints,
    cameraReveals,
    abilityEffects,
    tunnelSoundMessages,
    get silencedCount() {
      return silencedCount;
    },
  };
}

/**
 * Clear one specific ability's cooldown so a test doesn't have to wait out
 * the real initial delay. The delay itself is covered by its own test, which
 * does not use this. Composite-keyed by ability id since a role can have
 * several abilities now (Stranger: kill, sabotage, tunnel).
 */
function armAbility(room: ServerRoom<GameState>, sessionId: string, abilityId: string): void {
  (
    room as unknown as { abilityReadyAt: Map<string, number> }
  ).abilityReadyAt.set(`${sessionId}:${abilityId}`, 0);
}

/**
 * Split seats by FACTION (not exact role id) using their private role
 * message — "townsfolk" here means "not stranger-faction", which now
 * includes villager, doctor, detective, and every other townsfolk-faction
 * role, not just the fill role.
 */
function splitRoles<T extends { roleMessages: RoleAssignment[] }>(seats: T[]) {
  return {
    strangers: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.STRANGER),
    townsfolk: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.TOWNSFOLK),
  };
}

/** Find the one seat dealt a specific role, by its private role message. */
function seatWithRole<T extends { roleMessages: RoleAssignment[] }>(
  seats: T[],
  roleId: string,
): T {
  const seat = seats.find((s) => s.roleMessages[0]?.role === roleId);
  expect(seat).toBeDefined();
  return seat!;
}

/**
 * Every townsfolk-faction seat except `exclude` — the pool a role's own test
 * draws victims/targets/callers from. Needed because `splitRoles`'s
 * townsfolk bucket is faction-wide: under Chaos, a specialist role (doctor,
 * detective, ...) is itself townsfolk-faction and would otherwise show up
 * as its own eligible target.
 */
function otherTownsfolk<T extends { roleMessages: RoleAssignment[] }>(
  seats: T[],
  exclude: T,
): T[] {
  return splitRoles(seats).townsfolk.filter((s) => s !== exclude);
}

/**
 * Turn role selection off for a test that isn't about it.
 *
 * On by default in production, but it inserts a 20-second choice phase
 * between the start and the reveal — every suite below that just wants a
 * round running would otherwise wait it out, and get no roles until it
 * resolved. The dedicated "role selection" describe re-enables it.
 *
 * Must be sent by the host, in the lobby, before `start`.
 */
function disableRoleSelection(host: { client: { send: (t: string, m?: unknown) => void } }): void {
  host.client.send("set_setting", { id: "roleSelectionEnabled", value: false });
}

/** Put every seated player on the ready flagstone, so the room can be started. */
function readyUp(seats: readonly { player: Player }[]): void {
  for (const s of seats) {
    s.player.x = LOBBY_READY_PAD_POINT.x;
    s.player.y = LOBBY_READY_PAD_POINT.y;
  }
}

/**
 * Seat `count` players and start the game as the host, returning every seat.
 *
 * Ready is physical now: the host's start is refused unless `MIN_PLAYERS`
 * are standing on the Tavern's flagstone, so this walks everyone onto it
 * first. Note the round itself then scatters them across the plaza
 * (`handleStart`'s round-start respawn), so no test may assume a player is
 * still where this left them — set positions explicitly after starting.
 */
async function seatAndStart(room: ServerRoom<GameState>, count = MIN_PLAYERS) {
  const seats = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  disableRoleSelection(seats[0]!);
  await tick(1);
  readyUp(seats);
  seats[0]!.client.send("start");
  await tick(4);
  return seats;
}

/**
 * Put every player back on the same spot once the round is live.
 *
 * `seat()` co-locates players at the map centre so range-based abilities
 * (kill, report, investigate) can be exercised without every test doing its
 * own positioning. The round-start respawn scatters them across the plaza —
 * correct for the game, but it lands *after* `seat()` has placed them, so
 * without this the helper's promise of "everyone is next to each other"
 * would quietly stop holding and range checks would fail at random.
 *
 * Tests that care where the round actually starts people assert against
 * `seatAndStart` (before this runs) — see "moves everyone out to the plaza".
 */
function gatherAtCentre(seats: readonly { player: Player }[]): void {
  for (const s of seats) {
    s.player.x = MAP.width / 2;
    s.player.y = MAP.height / 2;
  }
}

/** Seat `count` players, start the game, and wait until the world is live. */
async function seatAndPlay(room: ServerRoom<GameState>, count = MIN_PLAYERS) {
  const seats = await seatAndStart(room, count);
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
  gatherAtCentre(seats);
  return seats;
}

/**
 * Seat `count` players, switch the lobby to Chaos (every registry role
 * enabled), and play. The per-role suites below each pick a `count` at
 * exactly that role's threshold so it deals deterministically — see the
 * table in `shared/config/roles.ts`.
 */
async function seatChaosAndPlay(room: ServerRoom<GameState>, count = 8) {
  const seats = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  seats[0]!.client.send("set_preset", { preset: PRESET.CHAOS });
  disableRoleSelection(seats[0]!);
  await tick(2);
  readyUp(seats);
  seats[0]!.client.send("start");
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
  gatherAtCentre(seats);
  return seats;
}

describe("GameRoom movement", () => {
  it("moves a player from input alone and acknowledges the sequence number", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client, player } = await seat(room);
    const startX = player.x;

    client.send("input", { seq: 1, dir: { x: 1, y: 0 } });
    await tick(3);

    expect(player.lastSeq).toBe(1);
    expect(player.x).toBeCloseTo(startX + STEP, 5);
    expect(player.y).toBeCloseTo(MAP.height / 2, 5);
  });

  it("normalises diagonals so they are not faster than an axis", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client, player } = await seat(room);
    const start = { x: player.x, y: player.y };

    client.send("input", { seq: 1, dir: { x: 1, y: 1 } });
    await tick(3);

    const travelled = Math.hypot(player.x - start.x, player.y - start.y);
    expect(travelled).toBeCloseTo(STEP, 5);
  });

  // The core trust test from the acceptance criteria.
  it("rejects a fabricated position smuggled alongside an input", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client, player } = await seat(room);
    const start = { x: player.x, y: player.y };

    // A malicious client tries to teleport by attaching a position to the
    // input message, in every shape the server might plausibly read.
    client.send("input", {
      seq: 1,
      dir: { x: 0, y: 0 },
      x: 9999,
      y: 9999,
      pos: { x: 9999, y: 9999 },
      position: { x: 9999, y: 9999 },
    });
    await tick(4);

    expect(player.x).toBe(start.x);
    expect(player.y).toBe(start.y);
  });

  it("ignores an unregistered position message entirely", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client, player } = await seat(room);
    const start = { x: player.x, y: player.y };

    client.send("position", { x: 12, y: 34 });
    client.send("move", { x: 12, y: 34 });
    await tick(4);

    expect(player.x).toBe(start.x);
    expect(player.y).toBe(start.y);
  });

  it("clamps an oversized direction to a unit step (no speed hack)", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client, player } = await seat(room);
    const startX = player.x;

    client.send("input", { seq: 1, dir: { x: 1000, y: 0 } });
    await tick(3);

    expect(player.x).toBeCloseTo(startX + STEP, 5);
  });

  it("ignores non-numeric and non-finite direction values", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client, player } = await seat(room);
    const start = { x: player.x, y: player.y };

    client.send("input", { seq: 1, dir: { x: "9999", y: Infinity } });
    client.send("input", { seq: 2, dir: { x: null, y: NaN } });
    await tick(5);

    expect(player.x).toBe(start.x);
    expect(player.y).toBe(start.y);
  });

  it("caps how much distance a flood of inputs can buy", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client, player } = await seat(room);
    const startX = player.x;

    // Ten times more input than a legitimate client would ever send.
    for (let seq = 1; seq <= 300; seq++) {
      client.send("input", { seq, dir: { x: 1, y: 0 } });
    }

    const ticks = 6;
    await tick(ticks);

    // The token budget lets the server process at most a full burst plus the
    // legitimate refill for the elapsed ticks — nowhere near the 300 sent.
    const maxCommands = INPUT_RATE + ticks * (INPUT_RATE / TICK_RATE);
    const travelled = player.x - startX;

    expect(travelled).toBeLessThanOrEqual(maxCommands * STEP);
    expect(travelled).toBeLessThan(300 * STEP * 0.25);
    expect(travelled).toBeGreaterThan(0);
  });

  // The literal acceptance test: force the client into a wall, and confirm
  // the server — not the client — is what decides the move doesn't happen.
  it("stops a player at a room wall no matter how much input is sent", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    // The Lighthouse's interior — a room with a single door on its south
    // side, so walking due north from its center runs straight into a wall
    // with nothing else in the way.
    const { client, player } = await seat(room, { at: TASK_ROOM_ANCHOR.lighthouse });
    const start = { x: player.x, y: player.y };

    // Far more input than the room is tall — if the wall didn't hold, this
    // would either clip through it or run all the way to the outer map edge.
    for (let seq = 1; seq <= 60; seq++) {
      client.send("input", { seq, dir: { x: 0, y: -1 } });
    }
    await tick(20);
    const stopped = { x: player.x, y: player.y };

    // Send the same flood again. If the wall is genuinely holding rather
    // than the player just being mid-approach, a second helping of identical
    // input changes nothing.
    for (let seq = 61; seq <= 120; seq++) {
      client.send("input", { seq, dir: { x: 0, y: -1 } });
    }
    await tick(20);

    expect(player.x).toBe(stopped.x);
    expect(player.y).toBe(stopped.y);

    // Real movement happened...
    expect(stopped.y).toBeLessThan(start.y);
    // ...but it was stopped well short of the outer map edge, which is what
    // it would take for the wall to have been silently ignored.
    expect(stopped.y).toBeGreaterThan(PLAYER_RADIUS + 50);
    // A pure north push must not drift sideways through a wall either.
    expect(stopped.x).toBe(start.x);
  });

  it("never lets one client move another player", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const a = await seat(room);
    const b = await seat(room);
    const startB = { x: b.player.x, y: b.player.y };

    a.client.send("input", { seq: 1, dir: { x: 1, y: 0 }, id: b.client.sessionId });
    a.client.send("input", { seq: 2, dir: { x: 1, y: 0 }, sessionId: b.client.sessionId });
    await tick(5);

    expect(b.player.x).toBe(startB.x);
    expect(b.player.y).toBe(startB.y);
    expect(a.player.x).toBeGreaterThan(MAP.width / 2);
  });
});

describe("GameRoom start", () => {
  it("lets the host start once the minimum player count is reached", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room);

    expect(room.state.hostId).toBe(seats[0]!.client.sessionId);
    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);
  });

  it("advances from the reveal to the world on its own", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await seatAndStart(room);
    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);

    // The server owns this transition — no client asked for it.
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 500));

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("ignores a start request from a non-host client", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS; i++) {
      seats.push(await seat(room));
    }

    readyUp(seats);
    seats[1]!.client.send("start");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    expect(seats.every((s) => s.roleMessages.length === 0)).toBe(true);
  });

  it("ignores a start request below the minimum player count", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const hostSeat = await seat(room);
    const { client: host, roleMessages } = hostSeat;

    // Below MIN_PLAYERS — only the host is seated, and they ARE ready, so
    // the head count is the only thing left that can refuse this.
    readyUp([hostSeat]);
    host.send("start");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    expect(roleMessages).toHaveLength(0);
  });

  it("refuses to start when enough players are present but not enough are ready", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS; i++) {
      seats.push(await seat(room));
    }
    // Everyone present, nobody on the flagstone — the pre-7.14 rule would
    // have started here. Ready is what gates it now.
    expect(room.state.players.size).toBe(MIN_PLAYERS);

    seats[0]!.client.send("start");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    expect(seats.every((s) => s.roleMessages.length === 0)).toBe(true);
  });

  it("refuses to start one player short of the ready minimum", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS + 1; i++) {
      seats.push(await seat(room));
    }
    // One short: plenty of players in the room, MIN_PLAYERS-1 on the stone.
    readyUp(seats.slice(0, MIN_PLAYERS - 1));
    await tick(2);

    seats[0]!.client.send("start");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
  });

  it("derives ready from position every tick, in both directions", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { player } = await seat(room);

    expect(player.ready).toBe(false);

    player.x = LOBBY_READY_PAD_POINT.x;
    player.y = LOBBY_READY_PAD_POINT.y;
    await tick(2);
    expect(player.ready).toBe(true);

    // Stepping off must clear it again — a one-way flag would let a player
    // ready up and wander away while still counting toward the start.
    player.x = LOBBY_SPAWN_ZONE.x * TILE_SIZE + PLAYER_RADIUS + 1;
    player.y = LOBBY_SPAWN_ZONE.y * TILE_SIZE + PLAYER_RADIUS + 1;
    await tick(2);
    expect(player.ready).toBe(false);
  });

  it("seats lobby arrivals in the Tavern, clear of the ready flagstone", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    for (let i = 0; i < MIN_PLAYERS; i++) {
      await seat(room, { at: undefined });
    }

    // `seat()` overrides the position, so re-read what onJoin actually chose
    // by adding one more player and inspecting it before any override.
    const client = await colyseus.connectTo(room, { name: "Fresh" });
    const fresh = room.state.players.get(client.sessionId)!;

    const minX = LOBBY_SPAWN_ZONE.x * TILE_SIZE;
    const maxX = (LOBBY_SPAWN_ZONE.x + LOBBY_SPAWN_ZONE.w) * TILE_SIZE;
    const minY = LOBBY_SPAWN_ZONE.y * TILE_SIZE;
    const maxY = (LOBBY_SPAWN_ZONE.y + LOBBY_SPAWN_ZONE.h) * TILE_SIZE;

    expect(fresh.x).toBeGreaterThanOrEqual(minX);
    expect(fresh.x).toBeLessThanOrEqual(maxX);
    expect(fresh.y).toBeGreaterThanOrEqual(minY);
    expect(fresh.y).toBeLessThanOrEqual(maxY);
    // Joining must never count as readying up.
    expect(isOnReadyPad(fresh.x, fresh.y)).toBe(false);
    expect(fresh.ready).toBe(false);
  });

  it("moves everyone out to the plaza and clears ready when the round starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room);

    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);

    const minX = SPAWN_ZONE.x * TILE_SIZE;
    const maxX = (SPAWN_ZONE.x + SPAWN_ZONE.w) * TILE_SIZE;
    const minY = SPAWN_ZONE.y * TILE_SIZE;
    const maxY = (SPAWN_ZONE.y + SPAWN_ZONE.h) * TILE_SIZE;

    for (const s of seats) {
      // Nobody begins the round standing in the Tavern they waited in.
      expect(s.player.x).toBeGreaterThanOrEqual(minX);
      expect(s.player.x).toBeLessThanOrEqual(maxX);
      expect(s.player.y).toBeGreaterThanOrEqual(minY);
      expect(s.player.y).toBeLessThanOrEqual(maxY);
      expect(s.player.ready).toBe(false);
    }
  });

  it("does not re-deal roles for a game already in progress", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room);

    // A late or duplicate start request must not throw, change the phase, or
    // hand anyone a second (possibly different) role.
    seats[0]!.client.send("start");
    await tick(4);

    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);
    expect(seats.every((s) => s.roleMessages.length === 1)).toBe(true);
  });

  it("closes the room to new players once the game starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await seatAndStart(room);

    // A late joiner would have no role and would have missed the reveal.
    await expect(colyseus.connectTo(room, { name: "Latecomer" })).rejects.toThrow();
    expect(room.state.players.size).toBe(MIN_PLAYERS);
  });
});

describe("resolveRoleCounts", () => {
  const CLASSIC_IDS = presetRoleIds(PRESET.CLASSIC);
  const CHAOS_IDS = presetRoleIds(PRESET.CHAOS);

  it("scales stranger seats with the player count per the shared config table", () => {
    const strangersAt = (n: number) => strangerFactionCount(n, CLASSIC_IDS);
    expect([4, 5, 6].map(strangersAt)).toEqual([1, 1, 1]);
    expect([7, 8, 9].map(strangersAt)).toEqual([2, 2, 2]);
    expect([10, 11, 16].map(strangersAt)).toEqual([3, 3, 3]);
  });

  it("hands the fill role every seat the specials did not take", () => {
    const counts = resolveRoleCounts(8, CLASSIC_IDS);
    expect(counts["stranger"]).toBe(2);
    expect(counts["villager"]).toBe(6);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(8);
  });

  it("deals a doctor under chaos at 5+ players, and none below the threshold", () => {
    expect(resolveRoleCounts(8, CHAOS_IDS)["doctor"]).toBe(1);
    expect(resolveRoleCounts(5, CHAOS_IDS)["doctor"]).toBe(1);
    expect(resolveRoleCounts(4, CHAOS_IDS)["doctor"]).toBe(0);
  });

  it("never deals a doctor a lobby did not enable", () => {
    expect(resolveRoleCounts(8, CLASSIC_IDS)["doctor"] ?? 0).toBe(0);
  });

  it("clamps stranger seats strictly below half the lobby, whatever the config asks", () => {
    // At 4 players the table asks for 1 — already below the cap of 1.
    expect(strangerFactionCount(4, CLASSIC_IDS)).toBe(1);
    // At 7 the table asks 2, cap is floor(6/2)=3 — config wins.
    expect(strangerFactionCount(7, CLASSIC_IDS)).toBe(2);
    // Degenerate lobby sizes can never start at or past parity.
    for (let n = MIN_PLAYERS; n <= 16; n++) {
      const strangers = strangerFactionCount(n, CHAOS_IDS);
      expect(strangers).toBeLessThan(n - strangers);
    }
  });

  it("reproduces today's exact threshold numbers when no override is given", () => {
    expect(resolveRoleCounts(8, CLASSIC_IDS)).toEqual(resolveRoleCounts(8, CLASSIC_IDS, {}));
    expect(strangerFactionCount(8, CLASSIC_IDS)).toBe(strangerFactionCount(8, CLASSIC_IDS, {}));
  });

  it("lets an override replace a role's threshold-table count, still subject to the stranger cap", () => {
    // The table would deal 1 stranger at 4 players; forcing 5 must still be
    // clamped strictly below half the lobby, same as an un-overridden config.
    const strangers = strangerFactionCount(4, CLASSIC_IDS, { stranger: 5 });
    expect(strangers).toBeLessThan(4 - strangers);
  });

  it("lets a small, in-range override take effect exactly", () => {
    const counts = resolveRoleCounts(9, CLASSIC_IDS, { stranger: 2 });
    expect(counts["stranger"]).toBe(2);
    expect(counts["villager"]).toBe(7);
  });
});

describe("GameRoom role assignment", () => {
  it("tells every player exactly one role, and only their own", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room);

    for (const s of seats) {
      expect(s.roleMessages).toHaveLength(1);
      expect([ROLES.STRANGER, ROLES.VILLAGER]).toContain(s.roleMessages[0]!.role);
    }
  });

  it("deals the configured number of strangers", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room, 8);

    const strangers = seats.filter((s) => s.roleMessages[0]!.role === ROLES.STRANGER);
    expect(strangers).toHaveLength(strangerFactionCount(8, presetRoleIds(PRESET.CLASSIC)));
  });

  it("lets strangers see each other but never themselves", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room, 8);

    const strangers = seats.filter((s) => s.roleMessages[0]!.role === ROLES.STRANGER);
    const strangerNames = strangers.map((s) => s.name);

    for (const s of strangers) {
      const fellows = s.roleMessages[0]!.fellows;
      expect([...fellows].sort()).toEqual(strangerNames.filter((n) => n !== s.name).sort());
      expect(fellows).not.toContain(s.name);
    }
  });

  it("tells townsfolk nothing about anyone else", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room, 8);

    const townsfolk = seats.filter((s) => s.roleMessages[0]!.role === ROLES.VILLAGER);
    expect(townsfolk.length).toBeGreaterThan(0);

    for (const s of townsfolk) {
      const message = s.roleMessages[0]!;
      expect(message.fellows).toEqual([]);

      // Nothing in what this player received names another player at all.
      const received = JSON.stringify(message);
      expect(received).not.toContain(ROLES.STRANGER);
      for (const other of seats) {
        if (other.name !== s.name) {
          expect(received).not.toContain(other.name);
        }
      }
    }
  });

  // The leak test from the acceptance criteria, at the state layer: whatever a
  // client can decode from the room state must contain no role information.
  it("never writes roles into public state", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room, 8);

    // The role SETTINGS fields legitimately name role ids: they are the
    // game's rules (which roles this lobby deals), a pure function of host
    // inputs identical for every client, carrying no player→role mapping.
    // Everything else must still be free of role strings — strip exactly
    // those two fields and scan the rest.
    //
    // The balance `settings` map is the same story one level down: its keys
    // are fixed, public tuning-parameter ids from `SETTING_DEFINITIONS` (e.g.
    // "strangerCount"), not player data — a blind substring scan would trip
    // on "stranger" inside that key name alone even though no role was ever
    // leaked. Scan its values (always plain numbers/booleans, never a role
    // id) but drop its key names before the substring check.
    const { enabledRoleIds, rolePreset, settings, ...rest } = room.state.toJSON() as Record<
      string,
      unknown
    >;
    const publicState = JSON.stringify({
      ...rest,
      settingsValues: Object.values((settings ?? {}) as Record<string, unknown>),
    });
    expect(publicState).not.toContain(ROLES.STRANGER);
    expect(publicState).not.toContain(ROLES.VILLAGER);

    // And the settings themselves are the same for everyone, regardless of
    // what was dealt — they describe the deck, never a hand.
    expect(enabledRoleIds).toEqual(presetRoleIds(PRESET.CLASSIC));
    expect(rolePreset).toBe(PRESET.CLASSIC);

    room.state.players.forEach((player) => {
      expect(player).not.toHaveProperty("role");
    });

    // And the same holds for the state a townsfolk actually decoded off the
    // wire — this object was built purely from bytes their socket received.
    const townsfolk = seats.find((s) => s.roleMessages[0]!.role === ROLES.VILLAGER)!;
    const {
      enabledRoleIds: _ids,
      rolePreset: _preset,
      settings: decodedSettings,
      ...decodedRest
    } = townsfolk.client.state.toJSON() as Record<string, unknown>;
    const decoded = JSON.stringify({
      ...decodedRest,
      settingsValues: Object.values((decodedSettings ?? {}) as Record<string, unknown>),
    });
    expect(decoded).not.toContain(ROLES.STRANGER);
    expect(decoded).not.toContain(ROLES.VILLAGER);
  });
});

describe("GameRoom tasks", () => {
  it("deals every player their common tasks plus the configured number of random extras", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const commonCount = TASK_DEFINITIONS.filter((t) => t.type === "common").length;

    for (const s of seats) {
      expect(s.taskMessages).toHaveLength(1);
      expect(s.taskMessages[0]!.tasks).toHaveLength(commonCount + RANDOM_TASKS_PER_PLAYER);
    }
  });

  it("includes every common task in every player's list", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const commonIds = TASK_DEFINITIONS.filter((t) => t.type === "common").map((t) => t.id);

    for (const s of seats) {
      const ids = s.taskMessages[0]!.tasks.map((t) => t.id);
      for (const id of commonIds) {
        expect(ids).toContain(id);
      }
    }
  });

  // Structural half of the acceptance criteria: a stranger's list must be
  // indistinguishable from a townsfolk's by inspection alone.
  it("gives a stranger a task list identical in shape to a townsfolk's", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);

    const strangers = seats.filter((s) => s.roleMessages[0]!.role === ROLES.STRANGER);
    const townsfolk = seats.filter((s) => s.roleMessages[0]!.role === ROLES.VILLAGER);
    expect(strangers.length).toBeGreaterThan(0);
    expect(townsfolk.length).toBeGreaterThan(0);

    const shapeOf = (t: ClientTask) => Object.keys(t).sort();
    const expectedShape = shapeOf(townsfolk[0]!.taskMessages[0]!.tasks[0]!);

    for (const s of [...strangers, ...townsfolk]) {
      for (const task of s.taskMessages[0]!.tasks) {
        expect(shapeOf(task)).toEqual(expectedShape);
        expect(task.completedSteps).toBe(0);
      }
    }
  });

  it("rejects an interaction sent before the game is playing", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room); // still in role_reveal, not playing
    const s = seats[0]!;

    s.client.send("task_interact", {
      taskId: s.taskMessages[0]?.tasks[0]?.id ?? "wiring-reactor",
    });
    await tick(3);

    expect(s.taskProgressMessages).toHaveLength(0);
  });

  it("rejects an interaction with a task not assigned to that player", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;

    const assignedIds = new Set(s.taskMessages[0]!.tasks.map((t) => t.id));
    const foreignTask = TASK_DEFINITIONS.find((t) => !assignedIds.has(t.id))!;
    expect(foreignTask).toBeDefined();

    s.player.x = foreignTask.x;
    s.player.y = foreignTask.y;
    s.client.send("task_interact", { taskId: foreignTask.id });
    await tick(3);

    expect(s.taskProgressMessages).toHaveLength(0);
    expect(room.state.taskBarCompleted).toBe(0);
  });

  // The distance-check half of the acceptance criteria.
  it("rejects an interaction when the player is too far from the task", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;

    const task = s.taskMessages[0]!.tasks[0]!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    s.player.x = def.x + TASK_INTERACT_RADIUS * 5;
    s.player.y = def.y;

    s.client.send("task_interact", { taskId: task.id });
    await tick(3);

    expect(s.taskProgressMessages).toHaveLength(0);
  });

  it("completes a step and raises the shared bar when a townsfolk interacts in range", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const s = seats.find((seat) => seat.roleMessages[0]!.role === ROLES.VILLAGER)!;

    const task = s.taskMessages[0]!.tasks.find((t) => t.totalSteps === 1)!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    s.player.x = def.x;
    s.player.y = def.y;

    const before = room.state.taskBarCompleted;
    s.client.send("task_interact", { taskId: task.id });
    await tick(3);

    expect(s.taskProgressMessages).toEqual([{ taskId: task.id, completedSteps: 1 }]);
    expect(room.state.taskBarCompleted).toBe(before + 1);
  });

  // THE critical acceptance test: a stranger's own completion never moves the
  // bar, but their own client receives the exact same progress message shape
  // a townsfolk would — nothing distinguishes the two on their own screen.
  it("does not raise the bar when a stranger completes a task, but reports identical progress", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const s = seats.find((seat) => seat.roleMessages[0]!.role === ROLES.STRANGER)!;
    expect(s).toBeDefined();

    const task = s.taskMessages[0]!.tasks.find((t) => t.totalSteps === 1)!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    s.player.x = def.x;
    s.player.y = def.y;

    const before = room.state.taskBarCompleted;
    s.client.send("task_interact", { taskId: task.id });
    await tick(3);

    expect(s.taskProgressMessages).toEqual([{ taskId: task.id, completedSteps: 1 }]);
    expect(room.state.taskBarCompleted).toBe(before);
  });

  it("requires multiple interacts to finish a multi-step task, and ignores interacts past completion", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    // 8 players independently drawing 4 of 7 non-common tasks makes the odds
    // of nobody getting either multi-step task astronomically small (~3e-7).
    const seats = await seatAndPlay(room, 8);

    let target: { seat: (typeof seats)[number]; taskId: string; totalSteps: number } | undefined;
    for (const s of seats) {
      const multi = s.taskMessages[0]!.tasks.find((t) => t.totalSteps > 1);
      if (multi) {
        target = { seat: s, taskId: multi.id, totalSteps: multi.totalSteps };
        break;
      }
    }
    expect(target).toBeDefined();

    const { seat: s, taskId, totalSteps } = target!;
    const def = TASK_DEFINITIONS_BY_ID.get(taskId)!;
    s.player.x = def.x;
    s.player.y = def.y;

    for (let i = 0; i < totalSteps; i++) {
      s.client.send("task_interact", { taskId });
    }
    await tick(3);

    expect(s.taskProgressMessages).toHaveLength(totalSteps);
    expect(s.taskProgressMessages.at(-1)!.completedSteps).toBe(totalSteps);

    // One more press past completion must be a no-op, not a 4th progress step.
    s.client.send("task_interact", { taskId });
    await tick(3);
    expect(s.taskProgressMessages).toHaveLength(totalSteps);
  });

  it("ignores a malformed or missing taskId without throwing", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;

    s.client.send("task_interact", {});
    s.client.send("task_interact", { taskId: 12345 });
    s.client.send("task_interact", { taskId: "does-not-exist" });
    await tick(3);

    expect(s.taskProgressMessages).toHaveLength(0);
  });

  // Defense-in-depth companion to the role leak test: per-player task
  // assignments and progress must never appear in public state either, only
  // the two aggregate bar numbers.
  it("never writes per-player task data into public state", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);

    for (const s of seats) {
      const task = s.taskMessages[0]!.tasks[0]!;
      const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
      s.player.x = def.x;
      s.player.y = def.y;
      s.client.send("task_interact", { taskId: task.id });
    }
    await tick(3);

    // An exact key list, so any new public field has to be considered here
    // rather than silently joining the broadcast.
    const publicState = room.state.toJSON() as Record<string, unknown>;
    expect(Object.keys(publicState).sort()).toEqual(
      [
        "bodies",
        "deadPlayerIds",
        "ejectedPlayerId",
        "ejectedPlayerName",
        "ejectedWasStranger",
        "ejectionConfirmed",
        "enabledRoleIds",
        "hostId",
        "meetingBodyId",
        "meetingBodyName",
        "meetingBodyRoom",
        "meetingIsEmergency",
        "meetingReporterId",
        "meetingStage",
        "finalRoster",
        "lampLit",
        "lockedRoomSlugs",
        "commsSabotageActive",
        "criticalSabotageActive",
        "criticalRepairedPoints",
        "phase",
        "players",
        "rolePreset",
        "sabotageActive",
        "settings",
        "taskBarCompleted",
        "taskBarTotal",
        "voteResults",
        "winningFaction",
        "winReason",
      ].sort(),
    );

    const serialized = JSON.stringify(publicState);
    for (const def of TASK_DEFINITIONS) {
      expect(serialized).not.toContain(def.id);
      expect(serialized).not.toContain(def.room);
    }

    room.state.players.forEach((player) => {
      expect(player).not.toHaveProperty("tasks");
      expect(player).not.toHaveProperty("completedSteps");
    });
  });
});

describe("GameRoom kill", () => {
  /** Seat a game and return the first stranger plus a townsfolk victim. */
  async function killSetup(room: ServerRoom<GameState>, count = MIN_PLAYERS) {
    const seats = await seatAndPlay(room, count);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    // Put them on top of each other so range is never the reason a test fails.
    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;
    return { seats, strangers, townsfolk, killer, victim };
  }

  it("kills a townsfolk in range and leaves a body where they fell", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room);
    armAbility(room, killer.client.sessionId, "kill");

    const deathX = victim.player.x;
    const deathY = victim.player.y;

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    expect(victim.player.alive).toBe(false);

    const body = room.state.bodies.get(victim.client.sessionId);
    expect(body).toBeDefined();
    expect(body!.x).toBeCloseTo(deathX, 5);
    expect(body!.y).toBeCloseTo(deathY, 5);
    expect(body!.name).toBe(victim.name);

    // The victim is told directly, which is what drives their death animation.
    expect(victim.killedMessages).toHaveLength(1);
    expect(victim.killedMessages[0]!.by).toBe(killer.client.sessionId);

    // The killer gets their own confirmation — the audio cue that a kill
    // just landed, distinct from `abilityState`'s cooldown value.
    expect(killer.killConfirmedCount).toBe(1);
  });

  it("does not confirm a kill that was rejected", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room);
    armAbility(room, killer.client.sessionId, "kill");

    victim.player.x = killer.player.x + KILL_RANGE * 3;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    expect(victim.player.alive).toBe(true);
    expect(killer.killConfirmedCount).toBe(0);
  });

  it("rejects a kill when the target is out of range", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room);
    armAbility(room, killer.client.sessionId, "kill");

    victim.player.x = killer.player.x + KILL_RANGE * 3;

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    expect(victim.player.alive).toBe(true);
    expect(realBodyCount(room)).toBe(0);
  });

  it("ignores a fabricated position sent with the kill and uses the server's own", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room);
    armAbility(room, killer.client.sessionId, "kill");

    // Genuinely far apart; the client lies about being adjacent.
    victim.player.x = killer.player.x + KILL_RANGE * 5;

    killer.client.send("ability", { abilityId: "kill",
      targetId: victim.client.sessionId,
      x: victim.player.x,
      y: victim.player.y,
      distance: 0,
    });
    await tick(3);

    expect(victim.player.alive).toBe(true);
  });

  it("enforces the initial delay before the first kill", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room);
    // Deliberately NOT armed — this is the one test that exercises the real delay.

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    expect(victim.player.alive).toBe(true);
    // The stranger was told about the delay as the world opened.
    expect(killer.abilityStateMessages[0]?.cooldownMs).toBe(KILL_INITIAL_DELAY_MS);
  });

  it("enforces the cooldown between kills", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, townsfolk } = await killSetup(room, 8);
    armAbility(room, killer.client.sessionId, "kill");

    const [first, second] = townsfolk;
    for (const t of [first!, second!]) {
      t.player.x = killer.player.x;
      t.player.y = killer.player.y;
    }

    killer.client.send("ability", { abilityId: "kill", targetId: first!.client.sessionId });
    await tick(3);
    expect(first!.player.alive).toBe(false);
    expect(killer.abilityStateMessages.at(-1)?.cooldownMs).toBe(KILL_COOLDOWN_MS);

    // Immediately again — the cooldown has not elapsed.
    killer.client.send("ability", { abilityId: "kill", targetId: second!.client.sessionId });
    await tick(3);
    expect(second!.player.alive).toBe(true);
  });

  it("does not consume the cooldown on a rejected attempt", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room);
    armAbility(room, killer.client.sessionId, "kill");

    // Out of range: rejected.
    victim.player.x = killer.player.x + KILL_RANGE * 3;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(true);

    // Back in range: the earlier failure must not have burned the cooldown.
    victim.player.x = killer.player.x;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);
  });

  it("does not let a townsfolk kill", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { townsfolk } = await killSetup(room, 8);
    const [attacker, victim] = townsfolk;

    armAbility(room, attacker!.client.sessionId, "kill"); // even if somehow armed
    victim!.player.x = attacker!.player.x;
    victim!.player.y = attacker!.player.y;

    attacker!.client.send("ability", { abilityId: "kill", targetId: victim!.client.sessionId });
    await tick(3);

    expect(victim!.player.alive).toBe(true);
    expect(realBodyCount(room)).toBe(0);
  });

  it("does not let a dead stranger kill", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, townsfolk } = await killSetup(room, 8);
    armAbility(room, killer.client.sessionId, "kill");

    // Kill the stranger off directly, then let them try to kill.
    killer.player.alive = false;

    const victim = townsfolk[0]!;
    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    expect(victim.player.alive).toBe(true);
  });

  it("does not let a stranger kill a fellow stranger", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    // 8 players guarantees 2 strangers.
    const seats = await seatAndPlay(room, 8);
    const { strangers } = splitRoles(seats);
    expect(strangers).toHaveLength(strangerFactionCount(8, presetRoleIds(PRESET.CLASSIC)));

    const [a, b] = strangers;
    armAbility(room, a!.client.sessionId, "kill");
    b!.player.x = a!.player.x;
    b!.player.y = a!.player.y;

    a!.client.send("ability", { abilityId: "kill", targetId: b!.client.sessionId });
    await tick(3);

    expect(b!.player.alive).toBe(true);
  });

  it("cannot kill an already-dead player, and cannot kill yourself", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room);
    armAbility(room, killer.client.sessionId, "kill");

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);
    expect(realBodyCount(room)).toBe(1);

    // Re-killing the corpse must not produce a second body.
    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(realBodyCount(room)).toBe(1);

    // Nor may a stranger kill themselves.
    killer.client.send("ability", { abilityId: "kill", targetId: killer.client.sessionId });
    await tick(3);
    expect(killer.player.alive).toBe(true);
    expect(realBodyCount(room)).toBe(1);
  });

  it("ignores a malformed kill message without throwing", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer } = await killSetup(room);
    armAbility(room, killer.client.sessionId, "kill");

    killer.client.send("ability", { abilityId: "kill" });
    killer.client.send("ability", { abilityId: "kill", targetId: 123 });
    killer.client.send("ability", { abilityId: "kill", targetId: "nobody" });
    await tick(3);

    expect(realBodyCount(room)).toBe(0);
  });

  it("lets a ghost keep doing tasks", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { killer, victim } = await killSetup(room, 8);
    armAbility(room, killer.client.sessionId, "kill");

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);

    const task = victim.taskMessages[0]!.tasks.find((t) => t.totalSteps === 1)!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    victim.player.x = def.x;
    victim.player.y = def.y;

    const barBefore = room.state.taskBarCompleted;
    victim.client.send("task_interact", { taskId: task.id });
    await tick(3);

    expect(GHOSTS_CAN_DO_TASKS).toBe(true);
    expect(victim.taskProgressMessages.at(-1)).toEqual({ taskId: task.id, completedSteps: 1 });
    // A dead townsfolk still fills the bar — see GHOSTS_CAN_DO_TASKS for why.
    expect(room.state.taskBarCompleted).toBe(barBefore + 1);
  });

  /**
   * The end-to-end kill, with none of the shortcuts every other test in this
   * suite takes.
   *
   * A playtest found the stranger unable to kill at all while all 630 tests
   * passed, and the reason is visible in the tests themselves: each one calls
   * `armAbility` to zero the cooldown and teleports the pair together by
   * writing `player.x` on the server. Both are reasonable isolation for the
   * rule they're each testing, but between them they skip the two things a
   * real client actually depends on — that `startAbilityCooldowns` armed the
   * kill at all, and that a killer who WALKS to a victim ends up genuinely in
   * range. Nothing exercised the plain "a stranger walks up to someone and
   * kills them" path, so nothing failed when it broke.
   *
   * So: no `armAbility` (the real `KILL_INITIAL_DELAY_MS` is waited out), and
   * the killer closes the distance with real `input` messages. The only
   * server-side positioning is the victim standing still — which is the point,
   * since a motionless target is exactly what the client-side fog regression
   * made un-targetable.
   */
  it("kills through the real flow — armed by the server, walked into range, no test hooks", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;

    // Both on the open plaza row the fog suite already uses as known-walkable
    // ground. The victim stands still from here on and is never written again.
    victim.player.x = 600;
    victim.player.y = 832;
    // The killer starts west of them, well outside KILL_RANGE.
    killer.player.x = 400;
    killer.player.y = 832;
    // Everyone else goes far away so nobody's death ends the round early.
    for (const s of seats) {
      if (s !== killer && s !== victim) {
        s.player.x = 1400;
        s.player.y = 1050;
      }
    }
    await tick(4);

    const distance = () =>
      Math.hypot(killer.player.x - victim.player.x, killer.player.y - victim.player.y);
    expect(distance()).toBeGreaterThan(KILL_RANGE);

    // The server arms every ability `KILL_INITIAL_DELAY_MS` after the world
    // opens (`startAbilityCooldowns`). Waiting it out rather than reaching
    // into `abilityReadyAt` is the whole point of this test: a regression
    // that never armed the kill would fail here, not silently pass.
    await new Promise((resolve) => setTimeout(resolve, KILL_INITIAL_DELAY_MS + 500));

    // Walk east with the same message a real client sends, letting the
    // server's own simulation decide where that puts them. Batched rather
    // than fired in one burst because the server rate-limits how many queued
    // inputs it will consume per tick (`MAX_INPUT_BUDGET`).
    let seq = 0;
    for (let batch = 0; batch < 12 && distance() > KILL_RANGE; batch++) {
      for (let i = 0; i < 10; i++) {
        killer.client.send("input", { seq: ++seq, dir: { x: 1, y: 0 } });
      }
      await tick(6);
    }

    expect(distance()).toBeLessThanOrEqual(KILL_RANGE);
    // The walk is what closed the gap — the victim never moved.
    expect(victim.player.x).toBe(600);
    expect(victim.player.y).toBe(832);

    const deathX = victim.player.x;
    const deathY = victim.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(6);

    // 1. Actually dead — not merely "the secrecy fields updated".
    expect(victim.player.alive).toBe(false);
    expect(killer.killConfirmedCount).toBe(1);
    expect(victim.killedMessages).toHaveLength(1);
    expect(victim.killedMessages[0]!.by).toBe(killer.client.sessionId);

    // 2. A real corpse, where they actually fell.
    const body = room.state.bodies.get(victim.client.sessionId);
    expect(body).toBeDefined();
    expect(body!.x).toBeCloseTo(deathX, 5);
    expect(body!.y).toBeCloseTo(deathY, 5);
    expect(realBodyCount(room)).toBe(1);

    // 3. A ghost: their lantern is on the ground (§4.4) and the round is
    //    still running, so this is a death, not a game-ending edge case.
    expect(victim.player.lanternState).toBe("dropped");
    expect(room.state.phase).toBe(PHASE.PLAYING);

    // 4. The room agrees they are dead once a meeting makes it public — the
    //    graveyard is rebuilt from the real `alive` flag, so a victim who was
    //    only half-killed would be missing here.
    killer.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(4);
    expect(room.state.phase).toBe(PHASE.MEETING);
    expect([...room.state.deadPlayerIds]).toContain(victim.client.sessionId);

    // Deliberately NOT asserted: removal from the task pool. Ghosts keep
    // filling the task bar on purpose — see `GHOSTS_CAN_DO_TASKS`, and the
    // test directly above this one, which pins that behaviour.
  }, 40_000);
});

describe("GameRoom ghost visibility", () => {
  /**
   * THE acceptance leak test. A living client's state is decoded purely from
   * the bytes their own socket received, so if a ghost's movement never shows
   * up there, those coordinates were never transmitted to them at all.
   */
  it("never sends ghost positions to living clients, but does send them to the dead", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { strangers, townsfolk } = splitRoles(seats);

    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const survivor = townsfolk[1]!;
    armAbility(room, killer.client.sessionId, "kill");

    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;
    // The survivor must actually be within fog range of the kill site, or
    // this assertion is vacuous: with everyone at their (random) round-start
    // spawn, `seenByLiving` below would either be undefined (never having
    // seen the victim at all) or a stale copy from some unrelated earlier
    // position, neither of which exercises "frozen at the death position."
    survivor.player.x = killer.player.x;
    survivor.player.y = killer.player.y;
    // Give the "still alive, at the new position" state a tick to actually
    // reach the survivor's client before death closes the filter — without
    // this, the position write and the `alive` flip can land in the same
    // patch, and the survivor's client never has a valid pre-death frame at
    // the death coordinates to freeze on at all.
    await tick(1);

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);
    expect(victim.player.alive).toBe(false);

    const deathX = victim.player.x;

    // Walk the ghost a long way from where they died.
    for (let seq = 1; seq <= 25; seq++) {
      victim.client.send("input", { seq, dir: { x: 1, y: 0 } });
    }
    await tick(25);

    const movedX = victim.player.x;
    expect(movedX).toBeGreaterThan(deathX + STEP * 5);

    // The living survivor's decoded view: the ghost is either gone entirely
    // or frozen at the death point — never at the new position.
    const seenByLiving = survivor.client.state.players.get(victim.client.sessionId);
    if (seenByLiving) {
      expect(seenByLiving.x).not.toBeCloseTo(movedX, 3);
      expect(seenByLiving.x).toBeCloseTo(deathX, 3);
    }

    // The dead victim's own client does see the new position — proving the
    // filter is selective rather than just dropping everyone's updates.
    const seenBySelf = victim.client.state.players.get(victim.client.sessionId);
    expect(seenBySelf).toBeDefined();
    expect(seenBySelf!.x).toBeCloseTo(movedX, 3);
  });

  it("still shows the living and the fallen to those standing with them", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const survivor = townsfolk[1]!;
    armAbility(room, killer.client.sessionId, "kill");

    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);

    // Living players remain mutually visible.
    expect(survivor.client.state.players.get(killer.client.sessionId)).toBeDefined();
    expect(killer.client.state.players.get(survivor.client.sessionId)).toBeDefined();

    // The ghost still sees the living.
    expect(victim.client.state.players.get(survivor.client.sessionId)).toBeDefined();

    // The body reaches whoever is close enough to see it — that's how the
    // living learn a kill happened. (Beyond the fog it is withheld, like
    // everything else — see the fog suite.)
    expect(survivor.client.state.bodies.get(victim.client.sessionId)).toBeDefined();
    expect(victim.client.state.bodies.get(victim.client.sessionId)).toBeDefined();
  });

  /**
   * Colyseus streams *changes*, not snapshots, and its per-child filter does
   * not re-send a child when a viewer's visibility of it opens up. So a
   * freshly-dead ghost holds whatever stale copy of the other ghosts it had
   * while alive, and only catches up once they next move. This pins that
   * behaviour down, because the client compensates for it (see
   * `GameScene.becomeGhost`).
   */
  it("delivers a ghost's live position to another ghost once they move", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const [ghostA, ghostB] = townsfolk;

    for (const victim of [ghostA!, ghostB!]) {
      armAbility(room, killer.client.sessionId, "kill");
      victim.player.x = killer.player.x;
      victim.player.y = killer.player.y;
      killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
      await tick(4);
      expect(victim.player.alive).toBe(false);
    }

    // Both are dead. Now move ghost A and check ghost B receives it.
    const beforeX = ghostA!.player.x;
    for (let seq = 1; seq <= 20; seq++) {
      ghostA!.client.send("input", { seq, dir: { x: 1, y: 0 } });
    }
    await tick(22);

    const movedX = ghostA!.player.x;
    expect(movedX).toBeGreaterThan(beforeX + STEP * 5);

    const seenByGhostB = ghostB!.client.state.players.get(ghostA!.client.sessionId);
    expect(seenByGhostB).toBeDefined();
    expect(seenByGhostB!.x).toBeCloseTo(movedX, 3);
  });

  it("keeps living players' own movement working after someone dies", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const survivor = townsfolk[1]!;
    armAbility(room, killer.client.sessionId, "kill");

    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);

    const startX = survivor.player.x;
    for (let seq = 1; seq <= 10; seq++) {
      survivor.client.send("input", { seq, dir: { x: 1, y: 0 } });
    }
    await tick(12);

    expect(survivor.player.x).toBeGreaterThan(startX);
    // And another living client sees that movement.
    const seenByKiller = killer.client.state.players.get(survivor.client.sessionId);
    expect(seenByKiller!.x).toBeCloseTo(survivor.player.x, 3);
  });
});

describe("GameRoom meetings", () => {
  /** Seat, start, and kill one townsfolk so there's a body to report. */
  async function meetingSetup(room: ServerRoom<GameState>, count = MIN_PLAYERS) {
    const seats = await seatAndPlay(room, count);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const reporter = townsfolk[1]!;

    armAbility(room, killer.client.sessionId, "kill");
    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);
    expect(victim.player.alive).toBe(false);

    return { seats, strangers, townsfolk, killer, victim, reporter };
  }

  it("starts a meeting when a body is reported in range", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { victim, reporter } = await meetingSetup(room);

    reporter.player.x = victim.player.x;
    reporter.player.y = victim.player.y;

    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.MEETING);
    expect(room.state.meetingReporterId).toBe(reporter.client.sessionId);
    expect(room.state.meetingBodyId).toBe(victim.client.sessionId);
    expect(room.state.meetingBodyName).toBe(victim.name);
    expect(room.state.meetingIsEmergency).toBe(false);
    // The §10.3 meeting-call cutscene's body-report title names this room —
    // captured at report time, since `startMeeting` clears `bodies` on the
    // same tick, leaving no position to recompute it from afterward.
    expect(room.state.meetingBodyRoom).toBe(roomSlugAt(victim.player.x, victim.player.y));
    expect(room.state.meetingBodyRoom).not.toBe("");
  });

  it("rejects a body report from out of range", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { victim, reporter } = await meetingSetup(room);

    reporter.player.x = victim.player.x + REPORT_BODY_RANGE * 3;
    reporter.player.y = victim.player.y;

    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("rejects a report of a body that doesn't exist", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { reporter } = await meetingSetup(room);

    reporter.client.send("report_body", { bodyId: "nobody-here" });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("does not let a dead player report a body", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { victim } = await meetingSetup(room);

    // The victim is dead; have them try to report their own body.
    victim.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("ignores a malformed report_body message", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { reporter } = await meetingSetup(room);

    reporter.client.send("report_body", {});
    reporter.client.send("report_body", { bodyId: 42 });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("rings the emergency bell in range and starts an emergency meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const ringer = seats[0]!;
    ringer.player.x = TOWN_HALL.x;
    ringer.player.y = TOWN_HALL.y;

    ringer.client.send("call_meeting");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.MEETING);
    expect(room.state.meetingReporterId).toBe(ringer.client.sessionId);
    expect(room.state.meetingIsEmergency).toBe(true);
    expect(room.state.meetingBodyId).toBe("");
    expect(room.state.meetingBodyName).toBe("");
    // No body room for an emergency — nothing to name in that title variant.
    expect(room.state.meetingBodyRoom).toBe("");
  });

  it("rejects ringing the bell from out of range", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const ringer = seats[0]!;
    ringer.player.x = TOWN_HALL.x + BELL_RANGE * 3;
    ringer.player.y = TOWN_HALL.y;

    ringer.client.send("call_meeting");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("limits the bell to the configured number of uses per player", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const ringer = seats[0]!;
    ringer.player.x = TOWN_HALL.x;
    ringer.player.y = TOWN_HALL.y;

    for (let i = 0; i < EMERGENCY_MEETINGS_PER_PLAYER; i++) {
      ringer.client.send("call_meeting");
      await tick(3);
      expect(room.state.phase).toBe(PHASE.MEETING);
      // Reset to playing by hand so the next ring can be attempted — there is
      // no meeting-resolution flow yet to do this for us.
      room.state.phase = PHASE.PLAYING;
    }

    // One more than the configured allowance must be rejected.
    ringer.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("does not consume a bell use on a rejected (out-of-range) attempt", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const ringer = seats[0]!;

    ringer.player.x = TOWN_HALL.x + BELL_RANGE * 3;
    ringer.player.y = TOWN_HALL.y;
    ringer.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    ringer.player.x = TOWN_HALL.x;
    ringer.player.y = TOWN_HALL.y;
    ringer.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);
  });

  it("locks the bell while a sabotage is active", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const ringer = seats[0]!;
    ringer.player.x = TOWN_HALL.x;
    ringer.player.y = TOWN_HALL.y;

    room.state.sabotageActive = true;

    ringer.client.send("call_meeting");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("clears every body from the map when a meeting starts, not just the reported one", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;

    // Two victims, so two bodies exist before the meeting.
    for (const victim of [townsfolk[0]!, townsfolk[1]!]) {
      armAbility(room, killer.client.sessionId, "kill");
      victim.player.x = killer.player.x;
      victim.player.y = killer.player.y;
      killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
      await tick(4);
    }
    expect(realBodyCount(room)).toBe(2);

    const reporter = townsfolk[2]!;
    reporter.player.x = townsfolk[0]!.player.x;
    reporter.player.y = townsfolk[0]!.player.y;
    reporter.client.send("report_body", { bodyId: townsfolk[0]!.client.sessionId });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.MEETING);
    expect(realBodyCount(room)).toBe(0);
  });

  it("teleports every player to the Town Hall when a meeting starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { victim, reporter, seats } = await meetingSetup(room, 8);

    reporter.player.x = victim.player.x;
    reporter.player.y = victim.player.y;
    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.MEETING);
    for (const s of seats) {
      const distance = Math.hypot(s.player.x - TOWN_HALL.x, s.player.y - TOWN_HALL.y);
      expect(distance).toBeCloseTo(MEETING_SPAWN_RADIUS, 3);
    }
  });

  it("locks movement once a meeting starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { victim, reporter, seats } = await meetingSetup(room);

    reporter.player.x = victim.player.x;
    reporter.player.y = victim.player.y;
    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);

    const frozenPositions = seats.map((s) => ({ x: s.player.x, y: s.player.y }));

    // Every living player tries to move; none of it should land.
    for (const s of seats) {
      for (let seq = 1; seq <= 10; seq++) {
        s.client.send("input", { seq, dir: { x: 1, y: 0 } });
      }
    }
    await tick(10);

    seats.forEach((s, i) => {
      expect(s.player.x).toBeCloseTo(frozenPositions[i]!.x, 5);
      expect(s.player.y).toBeCloseTo(frozenPositions[i]!.y, 5);
    });
  });

  it("does not let a second trigger overwrite an in-progress meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { victim, reporter, seats } = await meetingSetup(room);

    reporter.player.x = victim.player.x;
    reporter.player.y = victim.player.y;
    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);

    const firstReporter = room.state.meetingReporterId;

    const other = seats.find((s) => s.client.sessionId !== reporter.client.sessionId)!;
    other.player.x = TOWN_HALL.x;
    other.player.y = TOWN_HALL.y;
    other.client.send("call_meeting");
    await tick(3);

    // Still the same meeting — a second trigger during one must not overwrite it.
    expect(room.state.meetingReporterId).toBe(firstReporter);
  });
});

/**
 * Jump a meeting straight to the ballot instead of sitting out the real
 * 45-second discussion. The stage machine itself is covered by its own test,
 * which does not use this.
 */
function openBallot(room: ServerRoom<GameState>): void {
  (room as unknown as { enterStage(stage: string): void }).enterStage(MEETING_STAGE.VOTING);
}

describe("GameRoom voting", () => {
  /** Seat a room, ring the bell to start a meeting, and open the ballot. */
  async function ballotSetup(room: ServerRoom<GameState>, count = MIN_PLAYERS) {
    const seats = await seatAndPlay(room, count);
    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);

    openBallot(room);
    await tick(2);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.VOTING);

    return { seats, ...splitRoles(seats) };
  }

  it("moves through discussion into voting on its own", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);

    // A meeting opens in discussion, not straight on the ballot.
    expect(room.state.meetingStage).toBe(MEETING_STAGE.DISCUSSION);
  });

  it("marks a player as having voted without revealing their choice", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room);
    const [voter, target] = seats;

    voter!.client.send("vote", { targetId: target!.client.sessionId });
    await tick(3);

    expect(voter!.player.hasVoted).toBe(true);

    // Session ids are public in their own right (map keys, `Player.id`), so
    // the leak to guard against is the voter -> target *association*. While
    // the ballot is open nothing is published at all, and the association
    // lives only in the server-side map.
    expect(room.state.voteResults.size).toBe(0);

    const serverVotes = (room as unknown as { votes: Map<string, string> }).votes;
    expect(serverVotes.get(voter!.client.sessionId)).toBe(target!.client.sessionId);

    const publicPlayer = JSON.stringify(room.state.players.get(voter!.client.sessionId)!.toJSON());
    expect(publicPlayer).toContain('"hasVoted":true');
    expect(publicPlayer).not.toContain(target!.client.sessionId);
  });

  it("rejects a vote from a dead player", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, strangers, townsfolk } = await ballotSetup(room, 8);
    const ghost = townsfolk[0]!;

    // Kill them off directly, then have them try to vote.
    ghost.player.alive = false;

    ghost.client.send("vote", { targetId: strangers[0]!.client.sessionId });
    await tick(3);

    expect(ghost.player.hasVoted).toBe(false);
    expect(seats.length).toBeGreaterThan(0);
  });

  it("rejects a vote for a dead player", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room, 8);
    const [voter, corpse] = seats;
    corpse!.player.alive = false;

    voter!.client.send("vote", { targetId: corpse!.client.sessionId });
    await tick(3);

    expect(voter!.player.hasVoted).toBe(false);
  });

  it("rejects a vote outside the voting stage", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    // Still in discussion — the ballot is not open yet.
    expect(room.state.meetingStage).toBe(MEETING_STAGE.DISCUSSION);

    caller.client.send("vote", { targetId: seats[1]!.client.sessionId });
    await tick(3);

    expect(caller.player.hasVoted).toBe(false);
  });

  it("ignores a malformed vote", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room);
    const voter = seats[0]!;

    voter.client.send("vote", {});
    voter.client.send("vote", { targetId: 7 });
    voter.client.send("vote", { targetId: "nobody-here" });
    await tick(3);

    expect(voter.player.hasVoted).toBe(false);
  });

  it("keeps the first vote when votes are not changeable", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room, 8);
    const voter = seats[0]!;
    const first = seats[1]!;
    const second = seats[2]!;

    voter.client.send("vote", { targetId: first.client.sessionId });
    await tick(3);
    voter.client.send("vote", { targetId: second.client.sessionId });
    await tick(3);

    // Everyone else skips so the ballot resolves and we can read the tally.
    for (const s of seats.slice(1)) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(4);

    expect(VOTES_ARE_CHANGEABLE).toBe(false);
    expect(room.state.voteResults.get(first.client.sessionId)?.count).toBe(1);
    expect(room.state.voteResults.get(second.client.sessionId)).toBeUndefined();
  });

  it("resolves as soon as every living player has voted, without waiting out the timer", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room);
    const target = seats[1]!;

    for (const s of seats) {
      s.client.send("vote", { targetId: target.client.sessionId });
    }
    await tick(4);

    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
  });

  it("ejects the player with the most votes", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room, 8);
    const target = seats[1]!;

    // Everyone but the target votes for the target.
    for (const s of seats) {
      s.client.send("vote", {
        targetId: s === target ? SKIP_VOTE : target.client.sessionId,
      });
    }
    await tick(4);

    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
    expect(room.state.ejectedPlayerId).toBe(target.client.sessionId);
    expect(room.state.ejectedPlayerName).toBe(target.name);
    expect(target.player.alive).toBe(false);
    // Ejected players are thrown out, not killed where they stood.
    expect(realBodyCount(room)).toBe(0);
    expect([...room.state.deadPlayerIds]).toContain(target.client.sessionId);
  });

  it("ejects nobody when skip wins", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room, 8);

    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(4);

    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
    expect(room.state.ejectedPlayerId).toBe("");
    expect(seats.every((s) => s.player.alive)).toBe(true);
  });

  it("ejects nobody on a tie", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room, 4);
    const [a, b, c, d] = seats;

    // 2 for c, 2 for d — a dead heat.
    a!.client.send("vote", { targetId: c!.client.sessionId });
    b!.client.send("vote", { targetId: c!.client.sessionId });
    c!.client.send("vote", { targetId: d!.client.sessionId });
    d!.client.send("vote", { targetId: d!.client.sessionId });
    await tick(4);

    expect(TIE_EJECTS_NOBODY).toBe(true);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
    expect(room.state.ejectedPlayerId).toBe("");
    expect(seats.every((s) => s.player.alive)).toBe(true);
  });

  it("publishes counts but not individual ballots when votes are anonymous", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room, 8);
    const target = seats[1]!;

    for (const s of seats) {
      s.client.send("vote", { targetId: target.client.sessionId });
    }
    await tick(4);

    expect(VOTES_ARE_PUBLIC).toBe(false);
    const tally = room.state.voteResults.get(target.client.sessionId)!;
    expect(tally.count).toBe(seats.length);
    expect(tally.voterNames).toBe("");

    // No voter's name is attached to any tally anywhere in public state.
    const publicState = JSON.stringify(room.state.toJSON());
    for (const s of seats) {
      expect(publicState).not.toContain(`"voterNames":"${s.name}`);
    }
  });

  it("reveals whether the ejected player was a stranger when confirm-ejects is on", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, strangers } = await ballotSetup(room, 8);
    const target = strangers[0]!;

    for (const s of seats) {
      s.client.send("vote", { targetId: target.client.sessionId });
    }
    await tick(4);

    expect(CONFIRM_EJECTS).toBe(true);
    expect(room.state.ejectedPlayerId).toBe(target.client.sessionId);
    expect(room.state.ejectionConfirmed).toBe(true);
    expect(room.state.ejectedWasStranger).toBe(true);
  });

  it("reports a townsfolk ejection as not a stranger", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, townsfolk } = await ballotSetup(room, 8);
    const target = townsfolk[0]!;

    for (const s of seats) {
      s.client.send("vote", { targetId: target.client.sessionId });
    }
    await tick(4);

    expect(room.state.ejectedPlayerId).toBe(target.client.sessionId);
    expect(room.state.ejectedWasStranger).toBe(false);
  });

  it("returns to play with kill cooldowns reset once the results are done", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, strangers } = await ballotSetup(room, 8);
    const stranger = strangers[0]!;

    // Clear the stranger's cooldown so we can prove the meeting re-arms it.
    armAbility(room, stranger.client.sessionId, "kill");

    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(4);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);

    // Skip the results hold rather than waiting it out.
    (room as unknown as { endMeeting(): void }).endMeeting();
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
    expect(room.state.meetingStage).toBe("");

    const readyAt = (
      room as unknown as { abilityReadyAt: Map<string, number> }
    ).abilityReadyAt.get(`${stranger.client.sessionId}:kill`)!;
    expect(readyAt).toBeGreaterThan(Date.now());
    // The re-arm loop sends one message per ability slot (kill, sabotage,
    // tunnel) — the kill-specific one is what matters here, not whichever
    // happens to land last.
    const killMessage = stranger.abilityStateMessages.filter((m) => m.abilityId === "kill").at(-1);
    expect(killMessage?.cooldownMs).toBe(KILL_COOLDOWN_MS);
  });

  it("unlocks movement again after the meeting ends", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats } = await ballotSetup(room);

    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(4);
    (room as unknown as { endMeeting(): void }).endMeeting();
    await tick(3);

    const mover = seats[0]!;
    const startX = mover.player.x;
    for (let seq = 1; seq <= 10; seq++) {
      mover.client.send("input", { seq, dir: { x: 1, y: 0 } });
    }
    await tick(12);

    expect(mover.player.x).toBeGreaterThan(startX);
  });
});

describe("GameRoom chat", () => {
  async function chatSetup(room: ServerRoom<GameState>, count = 8) {
    const seats = await seatAndPlay(room, count);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;

    armAbility(room, killer.client.sessionId, "kill");
    victim.player.x = killer.player.x;
    victim.player.y = killer.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);
    expect(victim.player.alive).toBe(false);

    return { seats, strangers, townsfolk, killer, ghost: victim };
  }

  /** Put the room into a meeting so the living channel is open. */
  async function openMeeting(room: ServerRoom<GameState>, caller: { client: { send(t: string): void }; player: { x: number; y: number } }) {
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);
  }

  it("delivers a living player's chat to the other living players", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, townsfolk } = await chatSetup(room);
    const speaker = townsfolk[1]!;
    await openMeeting(room, speaker);

    speaker.client.send("chat", { text: "I saw them vent" });
    await tick(4);

    const living = seats.filter((s) => s.player.alive);
    for (const s of living) {
      expect(s.chatMessages.map((m) => m.text)).toContain("I saw them vent");
      expect(s.chatMessages.at(-1)!.channel).toBe(CHAT_CHANNEL.LIVING);
      expect(s.chatMessages.at(-1)!.senderName).toBe(speaker.name);
    }
  });

  // THE acceptance leak test for chat.
  it("never delivers dead chat to a living client", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, ghost } = await chatSetup(room);
    const secret = "GHOST-ONLY-SECRET-PHRASE";

    ghost.client.send("chat", { text: secret });
    await tick(4);

    const living = seats.filter((s) => s.player.alive);
    expect(living.length).toBeGreaterThan(0);
    for (const s of living) {
      const received = JSON.stringify(s.chatMessages);
      expect(received).not.toContain(secret);
      expect(received).not.toContain(CHAT_CHANNEL.DEAD);
    }

    // And the ghost themselves did receive it, so the test proves a filter
    // rather than a message that simply never went anywhere.
    expect(ghost.chatMessages.map((m) => m.text)).toContain(secret);
    expect(ghost.chatMessages.at(-1)!.channel).toBe(CHAT_CHANNEL.DEAD);
  });

  it("never delivers living chat to the dead", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { townsfolk, ghost } = await chatSetup(room);
    const speaker = townsfolk[1]!;
    await openMeeting(room, speaker);

    speaker.client.send("chat", { text: "living-only-line" });
    await tick(4);

    expect(JSON.stringify(ghost.chatMessages)).not.toContain("living-only-line");
  });

  it("keeps the living silent outside a meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, townsfolk } = await chatSetup(room);
    const speaker = townsfolk[1]!;

    // Still in PLAYING — no meeting is open.
    speaker.client.send("chat", { text: "should-not-send" });
    await tick(4);

    for (const s of seats) {
      expect(JSON.stringify(s.chatMessages)).not.toContain("should-not-send");
    }
  });

  it("lets the dead talk during play, when the living cannot", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { ghost } = await chatSetup(room);

    ghost.client.send("chat", { text: "dead-during-play" });
    await tick(4);

    expect(ghost.chatMessages.map((m) => m.text)).toContain("dead-during-play");
  });

  it("drops empty messages and trims oversized ones", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { ghost } = await chatSetup(room);

    ghost.client.send("chat", { text: "   " });
    await tick(3);
    expect(ghost.chatMessages).toHaveLength(0);

    ghost.client.send("chat", { text: "x".repeat(500) });
    await tick(3);
    expect(ghost.chatMessages).toHaveLength(1);
    expect(ghost.chatMessages[0]!.text.length).toBe(MAX_CHAT_LENGTH);
  });

  it("rate limits a flood of chat messages", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { ghost } = await chatSetup(room);

    for (let i = 0; i < 20; i++) {
      ghost.client.send("chat", { text: `flood-${i}` });
    }
    await tick(4);

    // The cooldown means only the first of a same-instant burst lands.
    expect(ghost.chatMessages.length).toBeLessThan(20);
    expect(ghost.chatMessages.length).toBeGreaterThan(0);
  });
});

describe("GameRoom win conditions", () => {
  /** Complete one real task, pushing the bar from one-short to full. */
  function finishLastTask(room: ServerRoom<GameState>, finisher: { player: Player; taskMessages: TasksMessage[]; client: { send(type: string, message?: unknown): void } }): void {
    room.state.taskBarCompleted = room.state.taskBarTotal - 1;

    const task = finisher.taskMessages[0]!.tasks.find((t) => t.totalSteps === 1)!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    finisher.player.x = def.x;
    finisher.player.y = def.y;
    finisher.client.send("task_interact", { taskId: task.id });
  }

  it("declares a townsfolk win when the task bar reaches 100%", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { townsfolk } = splitRoles(seats);

    finishLastTask(room, townsfolk[0]!);
    await tick(3);

    expect(room.state.phase).toBe(PHASE.GAME_OVER);
    expect(room.state.winningFaction).toBe(FACTION.TOWNSFOLK);
    expect(room.state.winReason).toBe(WIN_REASON.TASKS);
  });

  it("does not declare a win while the bar is still short", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { townsfolk } = splitRoles(seats);

    // Two short of the bar, then complete only one — still not full.
    room.state.taskBarCompleted = room.state.taskBarTotal - 2;
    const finisher = townsfolk[0]!;
    const task = finisher.taskMessages[0]!.tasks.find((t) => t.totalSteps === 1)!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    finisher.player.x = def.x;
    finisher.player.y = def.y;
    finisher.client.send("task_interact", { taskId: task.id });
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("declares a townsfolk win once every stranger is ejected", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 4);
    const { strangers, townsfolk } = splitRoles(seats);
    expect(strangers).toHaveLength(1);

    const caller = townsfolk[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);

    const target = strangers[0]!;
    for (const s of seats) {
      s.client.send("vote", { targetId: s === target ? SKIP_VOTE : target.client.sessionId });
    }
    await tick(4);

    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
    expect(room.state.ejectedPlayerId).toBe(target.client.sessionId);
    // The win is decided but held — the ejection reveal is still on screen.
    expect(room.state.phase).toBe(PHASE.MEETING);

    (room as unknown as { endMeeting(): void }).endMeeting();
    await tick(3);

    expect(room.state.phase).toBe(PHASE.GAME_OVER);
    expect(room.state.winningFaction).toBe(FACTION.TOWNSFOLK);
    expect(room.state.winReason).toBe(WIN_REASON.STRANGERS_EJECTED);
  });

  it("declares a strangers win once they reach parity with the living townsfolk", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 4);
    const { strangers, townsfolk } = splitRoles(seats);
    expect(strangers).toHaveLength(1);
    expect(townsfolk).toHaveLength(3);
    const killer = strangers[0]!;

    // First kill: 1 stranger vs 2 townsfolk — not parity yet.
    armAbility(room, killer.client.sessionId, "kill");
    townsfolk[0]!.player.x = killer.player.x;
    townsfolk[0]!.player.y = killer.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: townsfolk[0]!.client.sessionId });
    await tick(4);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    // Second kill: 1 stranger vs 1 townsfolk — parity.
    armAbility(room, killer.client.sessionId, "kill");
    townsfolk[1]!.player.x = killer.player.x;
    townsfolk[1]!.player.y = killer.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: townsfolk[1]!.client.sessionId });
    await tick(4);

    expect(room.state.phase).toBe(PHASE.GAME_OVER);
    expect(room.state.winningFaction).toBe(ROLES.STRANGER);
    expect(room.state.winReason).toBe(WIN_REASON.PARITY);
  });

  it("reveals every player's name and true role once the game ends", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { strangers, townsfolk } = splitRoles(seats);

    finishLastTask(room, townsfolk[0]!);
    await tick(3);
    expect(room.state.phase).toBe(PHASE.GAME_OVER);

    for (const s of strangers) {
      const entry = room.state.finalRoster.get(s.client.sessionId)!;
      expect(entry.role).toBe(ROLES.STRANGER);
      expect(entry.name).toBe(s.name);
    }
    for (const s of townsfolk) {
      const entry = room.state.finalRoster.get(s.client.sessionId)!;
      expect(entry.role).toBe(ROLES.VILLAGER);
      expect(entry.name).toBe(s.name);
    }
  });

  // The correctness issue this field exists to sidestep: an ejected/killed
  // player is dead by game-over time, and dead players are filtered out of
  // a living client's `players` map — so their name must not depend on it.
  it("includes dead players' names too, not just the living", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 4);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;

    armAbility(room, killer.client.sessionId, "kill");
    townsfolk[0]!.player.x = killer.player.x;
    townsfolk[0]!.player.y = killer.player.y;
    killer.client.send("ability", { abilityId: "kill", targetId: townsfolk[0]!.client.sessionId });
    await tick(4);
    expect(townsfolk[0]!.player.alive).toBe(false);

    finishLastTask(room, townsfolk[1]!);
    await tick(3);
    expect(room.state.phase).toBe(PHASE.GAME_OVER);

    const deadEntry = room.state.finalRoster.get(townsfolk[0]!.client.sessionId)!;
    expect(deadEntry.name).toBe(townsfolk[0]!.name);
    expect(deadEntry.role).toBe(ROLES.VILLAGER);
  });

  it("locks movement once the game ends", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 8);
    const { townsfolk } = splitRoles(seats);

    finishLastTask(room, townsfolk[0]!);
    await tick(3);
    expect(room.state.phase).toBe(PHASE.GAME_OVER);

    const mover = seats[1]!;
    const startX = mover.player.x;
    for (let seq = 1; seq <= 10; seq++) {
      mover.client.send("input", { seq, dir: { x: 1, y: 0 } });
    }
    await tick(10);

    expect(mover.player.x).toBeCloseTo(startX, 5);
  });
});

describe("GameRoom return to lobby", () => {
  async function reachGameOver(room: ServerRoom<GameState>, count = 8) {
    const seats = await seatAndPlay(room, count);
    const { townsfolk } = splitRoles(seats);

    room.state.taskBarCompleted = room.state.taskBarTotal - 1;
    const finisher = townsfolk[0]!;
    const task = finisher.taskMessages[0]!.tasks.find((t) => t.totalSteps === 1)!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    finisher.player.x = def.x;
    finisher.player.y = def.y;
    finisher.client.send("task_interact", { taskId: task.id });
    await tick(3);
    expect(room.state.phase).toBe(PHASE.GAME_OVER);

    return seats;
  }

  it("resets the room to a fresh lobby when the host requests it", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await reachGameOver(room);
    const host = seats.find((s) => s.client.sessionId === room.state.hostId)!;

    host.client.send("return_to_lobby");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    expect(room.state.winningFaction).toBe("");
    expect(room.state.winReason).toBe("");
    expect(room.state.finalRoster.size).toBe(0);
    expect(room.state.taskBarCompleted).toBe(0);
    expect(room.state.taskBarTotal).toBe(0);
    expect(realBodyCount(room)).toBe(0);
    expect(room.state.deadPlayerIds.length).toBe(0);
    expect(room.state.players.size).toBe(seats.length);
    seats.forEach((s) => {
      expect(s.player.alive).toBe(true);
      expect(s.player.hasVoted).toBe(false);
    });
  });

  it("ignores a return-to-lobby request from a non-host", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await reachGameOver(room);
    const nonHost = seats.find((s) => s.client.sessionId !== room.state.hostId)!;

    nonHost.client.send("return_to_lobby");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.GAME_OVER);
  });

  it("ignores a return-to-lobby request before the game has ended", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const host = seats.find((s) => s.client.sessionId === room.state.hostId)!;

    host.client.send("return_to_lobby");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("lets the same players start a new game after returning to the lobby", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await reachGameOver(room);
    const host = seats.find((s) => s.client.sessionId === room.state.hostId)!;

    host.client.send("return_to_lobby");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.LOBBY);

    for (const s of seats) {
      s.roleMessages.length = 0; // clear so the fresh deal is unambiguous
    }

    readyUp(seats);
    host.client.send("start");
    await tick(4);

    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);
    for (const s of seats) {
      expect(s.roleMessages).toHaveLength(1);
    }
  });

  it("reopens the room to new players after returning to the lobby", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await reachGameOver(room);
    const host = seats.find((s) => s.client.sessionId === room.state.hostId)!;

    host.client.send("return_to_lobby");
    await tick(3);

    await expect(colyseus.connectTo(room, { name: "Newcomer" })).resolves.toBeDefined();
  });
});

/** A seat as returned by `seat`, for helpers that take one. */
type Seat = Awaited<ReturnType<typeof seat>>;

/**
 * Simulate a connection dropping rather than a player leaving: closing the
 * socket without the consented-leave handshake is exactly what a closed tab, a
 * dead wifi connection or a killed browser looks like to the server.
 *
 * Returns the reconnection token that seat's browser would have stored â€” the
 * only thing a returning player needs to reclaim the seat.
 */
async function dropConnection(s: Seat): Promise<string> {
  const token = s.client.reconnectionToken;
  await s.client.leave(false);
  await tick(2);
  return token;
}

/**
 * Come back on a stored token, capturing the private messages the server
 * re-sends. Handlers are attached immediately after the reconnection resolves,
 * which is a full round trip before the server can deliver anything â€” the same
 * ordering the real client relies on.
 */
async function reconnectWith(token: string) {
  const client = await colyseus.sdk.reconnect<GameState>(token);

  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (message: RoleAssignment) => roleMessages.push(message));

  const taskMessages: TasksMessage[] = [];
  client.onMessage("tasks", (message: TasksMessage) => taskMessages.push(message));

  const abilityStateMessages: AbilityStateMessage[] = [];
  client.onMessage("abilityState", (message: AbilityStateMessage) => abilityStateMessages.push(message));

  await tick(4);
  return { client, roleMessages, taskMessages, abilityStateMessages };
}

/**
 * End a grace period early instead of sitting out the real 30 seconds. The
 * duration itself is config; what matters here is what expiry *does*.
 */
function expireGrace(room: ServerRoom<GameState>, sessionId: string): void {
  (room as unknown as { reconnections: Map<string, { reject(): void }> }).reconnections
    .get(sessionId)
    ?.reject();
}

describe("GameRoom reconnection", () => {
  it("holds a dropped player's seat, position and role for the grace period", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const dropped = seats[1]!;
    const sessionId = dropped.client.sessionId;
    const at = { x: dropped.player.x, y: dropped.player.y };
    const role = dropped.roleMessages[0]!.role;

    await dropConnection(dropped);

    const held = room.state.players.get(sessionId);
    expect(held).toBeDefined();
    expect(held!.connected).toBe(false);
    // Still standing exactly where they were, and still whatever they were.
    expect(held!.x).toBeCloseTo(at.x, 5);
    expect(held!.y).toBeCloseTo(at.y, 5);
    expect((room as unknown as { roles: Map<string, string> }).roles.get(sessionId)).toBe(role);
  });

  it("gives a returning player back the same seat, role and task list", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const dropped = seats[1]!;
    const sessionId = dropped.client.sessionId;
    const role = dropped.roleMessages[0]!.role;
    const originalTasks = dropped.taskMessages[0]!.tasks;

    const token = await dropConnection(dropped);
    const back = await reconnectWith(token);

    // The same seat, not a new one â€” which is what keeps every server-side map
    // keyed by session id pointing at the right player.
    expect(back.client.sessionId).toBe(sessionId);
    expect(room.state.players.get(sessionId)!.connected).toBe(true);

    // The private messages are re-sent, because the socket they first went to
    // no longer exists.
    expect(back.roleMessages).toHaveLength(1);
    expect(back.roleMessages[0]!.role).toBe(role);
    expect(back.taskMessages).toHaveLength(1);
    expect(back.taskMessages[0]!.tasks.map((t) => t.id).sort()).toEqual(
      originalTasks.map((t) => t.id).sort(),
    );
  });

  it("returns a stranger the time left on their cooldown, not a fresh one", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const stranger = splitRoles(seats).strangers[0]!;

    const token = await dropConnection(stranger);
    const back = await reconnectWith(token);

    // One message per ability slot the Stranger has (kill, sabotage, tunnel) —
    // this only checks the kill slot's.
    expect(back.abilityStateMessages.length).toBeGreaterThanOrEqual(1);
    const killMessage = back.abilityStateMessages.find((m) => m.abilityId === "kill");
    const remaining = killMessage!.cooldownMs;
    expect(remaining).toBeGreaterThan(0);
    // Strictly less than a full delay: time passed while they were away, and
    // coming back must not buy them a reset.
    expect(remaining).toBeLessThan(KILL_INITIAL_DELAY_MS);
  });

  it("keeps completed task progress across a reconnection", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const worker = splitRoles(seats).townsfolk[0]!;

    // Any task will do — every one has at least a first step, and one step of
    // real progress is all this needs to survive the round trip.
    const task = worker.taskMessages[0]!.tasks[0]!;
    const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
    worker.player.x = def.x;
    worker.player.y = def.y;
    worker.client.send("task_interact", { taskId: task.id });
    await tick(3);

    const token = await dropConnection(worker);
    const back = await reconnectWith(token);

    const restored = back.taskMessages[0]!.tasks.find((t) => t.id === task.id)!;
    expect(restored.completedSteps).toBe(1);
  });

  it("removes a player once the grace period expires", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 6);
    const dropped = seats[5]!;
    const sessionId = dropped.client.sessionId;

    await dropConnection(dropped);
    expect(room.state.players.has(sessionId)).toBe(true);

    expireGrace(room, sessionId);
    await tick(3);

    expect(room.state.players.has(sessionId)).toBe(false);
  });

  it("removes a player immediately when they leave deliberately", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 6);
    const leaver = seats[5]!;
    const sessionId = leaver.client.sessionId;

    await leaver.client.leave();
    await tick(3);

    // No seat held: they meant to go, so there is nothing to come back to.
    expect(room.state.players.has(sessionId)).toBe(false);
  });

  it("drops players who never came back when the round starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS + 1; i++) {
      seats.push(await seat(room));
    }
    const absent = seats[MIN_PLAYERS]!;
    const absentId = absent.client.sessionId;

    await dropConnection(absent);
    expect(room.state.players.has(absentId)).toBe(true);

    readyUp(seats);
    seats[0]!.client.send("start");
    await tick(4);

    // Roles are dealt once. Someone who isn't listening cannot be dealt one,
    // so the round starts without them rather than with a role nobody holds.
    expect(room.state.phase).toBe(PHASE.ROLE_REVEAL);
    expect(room.state.players.has(absentId)).toBe(false);
    expect((room as unknown as { roles: Map<string, string> }).roles.has(absentId)).toBe(false);
  });

  it("will not start a round on the strength of players who have dropped", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS; i++) {
      seats.push(await seat(room));
    }

    await dropConnection(seats[MIN_PLAYERS - 1]!);

    readyUp(seats);
    seats[0]!.client.send("start");
    await tick(4);

    expect(room.state.phase).toBe(PHASE.LOBBY);
  });
});

describe("GameRoom host handover", () => {
  it("passes the host on when the host leaves the lobby", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);
    const other = await seat(room);
    expect(room.state.hostId).toBe(host.client.sessionId);

    await host.client.leave();
    await tick(3);

    expect(room.state.hostId).toBe(other.client.sessionId);
  });

  it("passes the host to someone present when the host drops mid-game", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const hostId = room.state.hostId;
    const host = seats.find((s) => s.client.sessionId === hostId)!;

    await dropConnection(host);

    // The game does not stop, and the room is not left hostless.
    expect(room.state.phase).toBe(PHASE.PLAYING);
    expect(room.state.hostId).not.toBe(hostId);
    expect(room.state.players.get(room.state.hostId)!.connected).toBe(true);
  });

  it("gives the host to whoever comes back when nobody is connected", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);
    const other = await seat(room);

    const hostToken = await dropConnection(host);
    expect(room.state.hostId).toBe(other.client.sessionId);

    await dropConnection(other);
    // Nobody is connected to hold it â€” a legitimate resting state, not a bug.
    expect(room.state.hostId).toBe("");

    const back = await reconnectWith(hostToken);
    expect(room.state.hostId).toBe(back.client.sessionId);
  });
});

describe("GameRoom departures mid-game", () => {
  it("hands the town the win when the last stranger leaves", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const { strangers } = splitRoles(seats);
    expect(strangers).toHaveLength(1);

    await strangers[0]!.client.leave();
    await tick(3);

    expect(room.state.phase).toBe(PHASE.GAME_OVER);
    expect(room.state.winningFaction).toBe(FACTION.TOWNSFOLK);
    // Named apart from an ejection: nobody caught anyone, they just left.
    expect(room.state.winReason).toBe(WIN_REASON.STRANGERS_LEFT);
  });

  it("hands the strangers the win when enough townsfolk leave to reach parity", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const { townsfolk } = splitRoles(seats);
    expect(townsfolk).toHaveLength(3);

    await townsfolk[0]!.client.leave();
    await tick(3);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    await townsfolk[1]!.client.leave();
    await tick(3);

    expect(room.state.phase).toBe(PHASE.GAME_OVER);
    expect(room.state.winningFaction).toBe(ROLES.STRANGER);
    expect(room.state.winReason).toBe(WIN_REASON.PARITY);
  });

  it("takes a departing townsfolk's unfinished work off the shared bar", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, 6);
    const leaver = splitRoles(seats).townsfolk[0]!;

    const progress = (
      room as unknown as {
        tasks: Map<string, Map<string, { totalSteps: number; completedSteps: number }>>;
      }
    ).tasks.get(leaver.client.sessionId)!;
    let outstanding = 0;
    for (const task of progress.values()) {
      outstanding += task.totalSteps - task.completedSteps;
    }
    expect(outstanding).toBeGreaterThan(0);

    const totalBefore = room.state.taskBarTotal;
    await leaver.client.leave();
    await tick(3);

    // Otherwise the bar could never be filled again and the town would
    // silently lose one of its two ways to win.
    expect(room.state.taskBarTotal).toBe(totalBefore - outstanding);
  });

  it("does not hold the ballot open waiting on a player who has dropped", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    seats[0]!.player.x = TOWN_HALL.x;
    seats[0]!.player.y = TOWN_HALL.y;
    seats[0]!.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);

    await dropConnection(seats[3]!);

    for (const s of seats.slice(0, 3)) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(4);

    // Resolved on the votes of everyone who could actually cast one, rather
    // than parking the whole room on the voting screen for the full timer.
    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
  });

  it("closes the ballot when the last vote it was waiting on drops away", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    seats[0]!.player.x = TOWN_HALL.x;
    seats[0]!.player.y = TOWN_HALL.y;
    seats[0]!.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);

    for (const s of seats.slice(0, 3)) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.VOTING);

    await dropConnection(seats[3]!);

    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
  });
});

describe("GameRoom join errors", () => {
  it("refuses a join once the game has started, and says so", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await seatAndPlay(room);

    await expect(colyseus.connectTo(room, { name: "Latecomer" })).rejects.toMatchObject({
      code: JOIN_ERROR.IN_PROGRESS,
    });
  });

  it("refuses a join when the room is full, and says so", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    for (let i = 0; i < MAX_PLAYERS; i++) {
      await seat(room);
    }
    expect(room.state.players.size).toBe(MAX_PLAYERS);

    // Distinguishable from a bad code, which is the whole reason the room
    // keeps a seat of headroom above `MAX_PLAYERS`.
    await expect(colyseus.connectTo(room, { name: "Overflow" })).rejects.toMatchObject({
      code: JOIN_ERROR.ROOM_FULL,
    });
  });

  it("rejects an unknown room code", async () => {
    await expect(colyseus.sdk.joinById("NOSUCH", { name: "Lost" })).rejects.toBeDefined();
  });

  it("still lets a dropped player back into a room that has since filled up", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      seats.push(await seat(room));
    }

    const token = await dropConnection(seats[0]!);
    // Their seat is still held, so the room is still full â€” a newcomer cannot
    // take the place of someone on their way back.
    await expect(colyseus.connectTo(room, { name: "Opportunist" })).rejects.toMatchObject({
      code: JOIN_ERROR.ROOM_FULL,
    });

    const back = await reconnectWith(token);
    expect(back.client.sessionId).toBe(seats[0]!.client.sessionId);
    expect(room.state.players.get(back.client.sessionId)!.connected).toBe(true);
  });
});

describe("GameRoom fog of war", () => {
  /**
   * THE acceptance leak test for the fog, mirroring the ghost one above: a
   * client's decoded state is built purely from bytes its own socket
   * received, so a position that never shows up there was never transmitted.
   *
   * Everyone is mutually synced in the lobby (the fog only applies during
   * play), so a stale pre-fog copy may legitimately exist — the property
   * that matters is that it never tracks the target's live movement.
   */
  it("never sends fresh positions from beyond a living player's vision", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [a, b, c] = [seats[0]!, seats[1]!, seats[2]!];

    // A far west in the plaza; B far east — 800 units apart, way beyond the
    // outdoor radius. C lands 48 units from A as the positive control.
    a.player.x = 352;
    a.player.y = 832;
    b.player.x = 1152;
    b.player.y = 832;
    c.player.x = 400;
    c.player.y = 832;
    // Extra settling margin: these positions must actually have propagated
    // (and the far-apart pair correctly excluded) before B starts moving, or
    // an in-flight patch straddling "just repositioned" and "already
    // walking" can carry a stale intermediate value past the fog check —
    // the same class of same-patch race documented on the ghost-visibility
    // test above.
    await tick(8);

    // B walks south; these fresh coordinates must never reach A.
    for (let seq = 1; seq <= 20; seq++) {
      b.client.send("input", { seq, dir: { x: 0, y: 1 } });
    }
    await tick(6);

    const aSeesB = a.client.state.players.get(b.client.sessionId);
    if (aSeesB) {
      // Whatever A holds predates the teleport — a lobby-era relic, not a
      // live feed. Both axes must be far from B's actual location.
      expect(Math.abs(aSeesB.x - b.player.x)).toBeGreaterThan(200);
      expect(Math.abs(aSeesB.y - b.player.y)).toBeGreaterThan(100);
    }

    // The positive controls: C, standing next to A, IS delivered fresh —
    // and B's own client tracks itself exactly. The filter is selective,
    // not simply broken.
    const aSeesC = a.client.state.players.get(c.client.sessionId);
    expect(aSeesC).toBeDefined();
    expect(aSeesC!.x).toBeCloseTo(400, 3);
    expect(aSeesC!.y).toBeCloseTo(832, 3);

    const bSeesSelf = b.client.state.players.get(b.client.sessionId);
    expect(bSeesSelf!.y).toBeCloseTo(b.player.y, 3);
  });

  it("keeps a wall opaque at close range, and a doorway transparent", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [a, b] = [seats[0]!, seats[1]!];

    // A inside the tavern against its east wall; B in the plaza just across
    // that wall. 64 units apart — nothing but bricks between them.
    a.player.x = 272;
    a.player.y = 656;
    b.player.x = 336;
    b.player.y = 656;
    await tick(4);

    const throughWall = a.client.state.players.get(b.client.sessionId);
    if (throughWall) {
      // Still the lobby-era relic — the teleported position never crossed.
      expect(throughWall.x).not.toBeCloseTo(336, 0);
    }

    // Slide the pair up to the tavern's doorway: same 64 units, but now the
    // sight line runs through the open door and B comes through.
    a.player.y = 560;
    b.player.y = 560;
    await tick(4);

    const throughDoor = a.client.state.players.get(b.client.sessionId);
    expect(throughDoor).toBeDefined();
    expect(throughDoor!.x).toBeCloseTo(336, 3);
    expect(throughDoor!.y).toBeCloseTo(560, 3);
  });

  /**
   * A playtest found every motionless player invisible to everyone else, and
   * this is the shape of it. It is deliberately asserted at the CLIENT
   * callback level rather than on decoded state, because decoded state was
   * never the broken half.
   *
   * The server side always worked: `GameRoom.update` re-dirties every
   * position each tick, the fog filter re-runs, and the bytes really do go
   * out (measured — a room where nobody moves still pushes a patch per tick).
   * What broke is that @colyseus/schema's decoder raises a change callback
   * only when a decoded value DIFFERS from what the client already holds, so
   * re-sending a standing player's unchanged x/y was indistinguishable, to
   * the client, from sending nothing. `GameScene` derives visibility from
   * exactly those callbacks (`lastFreshAt` / `VISIBILITY_TIMEOUT_MS`), so a
   * player who stopped moving vanished ~350ms later — and, since the kill
   * button only targets fog-visible entities, became unkillable too.
   *
   * Hence the assertion: not "does B's state contain A" (it always did — a
   * filter retracts nothing, so a stale lobby-era copy is there regardless),
   * but "does B's client observe A arriving, tick after tick, while A stands
   * perfectly still". `Player.heartbeat` is what makes that observable; this
   * test fails without it.
   */
  it("keeps delivering a player who never moves, observably, to a client that can see them", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [a, b] = [seats[0]!, seats[1]!];

    // Standing together on the open plaza — well inside vision, no wall.
    a.player.x = 400;
    a.player.y = 832;
    b.player.x = 440;
    b.player.y = 832;
    // Everyone else far away, so they cannot be the source of any callback.
    for (const s of seats.slice(2)) {
      s.player.x = 1400;
      s.player.y = 1050;
    }
    await tick(6);

    const bSeesA = b.client.state.players.get(a.client.sessionId);
    expect(bSeesA).toBeDefined();

    // From here on NOTHING touches A. Any callback below is the server
    // continuing to deliver a completely motionless player.
    let observedArrivals = 0;
    bSeesA!.onChange(() => observedArrivals++);
    await tick(15);

    expect(observedArrivals).toBeGreaterThan(0);
    // One per patch, near enough — the point is that it never goes quiet for
    // longer than the client's own VISIBILITY_TIMEOUT_MS (350ms ≈ 7 ticks).
    expect(observedArrivals).toBeGreaterThanOrEqual(5);

    // And the position stayed truthful the whole time, not just "some field
    // changed": a liveness signal that cost correctness would be no fix.
    expect(bSeesA!.x).toBeCloseTo(400, 3);
    expect(bSeesA!.y).toBeCloseTo(832, 3);
  });

  /**
   * The other half of the same guarantee: the heartbeat must not become a
   * back door around the fog. A player standing still across the map stays
   * exactly as hidden as they were before — no callbacks, nothing fresh.
   */
  it("does not deliver a motionless player who is beyond vision", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [a, b] = [seats[0]!, seats[1]!];

    a.player.x = 352;
    a.player.y = 832;
    b.player.x = 1152;
    b.player.y = 832;
    await tick(8);

    const bSeesA = b.client.state.players.get(a.client.sessionId);
    // A stale pre-fog copy may exist (filters retract nothing) — what must
    // not happen is a live feed of it.
    if (bSeesA) {
      let leaked = 0;
      bSeesA.onChange(() => leaked++);
      await tick(15);
      expect(leaked).toBe(0);
    }
  });

  it("lets the dead watch the whole town", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [a, b] = [seats[0]!, seats[1]!];

    a.player.x = 352;
    a.player.y = 832;
    b.player.x = 1152;
    b.player.y = 832;
    await tick(3);

    // A dies. Their vision — and only theirs — becomes unlimited.
    a.player.alive = false;
    await tick(4);

    const deadSeesB = a.client.state.players.get(b.client.sessionId);
    expect(deadSeesB).toBeDefined();
    expect(deadSeesB!.x).toBeCloseTo(b.player.x, 3);
    expect(deadSeesB!.y).toBeCloseTo(b.player.y, 3);
  });

  it("rejects a kill through a wall, and allows it through the doorway", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    armAbility(room, killer.client.sessionId, "kill");

    // 42 units apart — inside KILL_RANGE — but the tavern's east wall
    // stands between them.
    killer.player.x = 283;
    killer.player.y = 656;
    victim.player.x = 325;
    victim.player.y = 656;

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);
    expect(victim.player.alive).toBe(true);

    // The same distance at the doorway: the knife connects.
    killer.player.y = 560;
    victim.player.y = 560;

    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);
    expect(victim.player.alive).toBe(false);
  });

  it("rejects reporting a body hidden behind a wall", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victim = townsfolk[0]!;
    const reporter = townsfolk[1]!;
    armAbility(room, killer.client.sessionId, "kill");

    // The kill happens deep inside the warehouse.
    killer.player.x = 1258;
    killer.player.y = 608;
    victim.player.x = 1258;
    victim.player.y = 608;
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(4);
    expect(victim.player.alive).toBe(false);

    // The reporter stands in the plaza, 58 units from the corpse — in
    // range, but with the warehouse's west wall in between. Sending the
    // report anyway is exactly the id-fishing attack the LOS check exists
    // to stop.
    reporter.player.x = 1200;
    reporter.player.y = 608;
    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    // Stepping through the warehouse door makes it a legitimate discovery.
    reporter.player.x = 1290;
    reporter.player.y = 608;
    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);
  });

  it("lifts the fog for a meeting so every ballot has every face", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [a, b, caller] = [seats[0]!, seats[1]!, seats[2]!];

    a.player.x = 352;
    a.player.y = 832;
    b.player.x = 1152;
    b.player.y = 832;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    await tick(3);

    caller.client.send("call_meeting");
    await tick(4);
    expect(room.state.phase).toBe(PHASE.MEETING);

    // Everyone was teleported to the Town Hall circle, and with the fog
    // lifted, A's client now tracks B's real (teleported) position.
    const aSeesB = a.client.state.players.get(b.client.sessionId);
    expect(aSeesB).toBeDefined();
    expect(aSeesB!.x).toBeCloseTo(b.player.x, 3);
    expect(aSeesB!.y).toBeCloseTo(b.player.y, 3);
  });
});

describe("GameRoom lobby role settings", () => {
  it("lets the host apply a preset, replacing the enabled set", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);
    await seat(room);

    host.client.send("set_preset", { preset: PRESET.CHAOS });
    await tick(2);
    expect([...room.state.enabledRoleIds]).toEqual(presetRoleIds(PRESET.CHAOS));
    expect(room.state.rolePreset).toBe(PRESET.CHAOS);

    host.client.send("set_preset", { preset: PRESET.PURE });
    await tick(2);
    expect([...room.state.enabledRoleIds]).toEqual(presetRoleIds(PRESET.PURE));
    expect(room.state.rolePreset).toBe(PRESET.PURE);
  });

  it("ignores presets and toggles from a non-host", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await seat(room);
    const guest = await seat(room);

    guest.client.send("set_preset", { preset: PRESET.CHAOS });
    guest.client.send("set_role_enabled", { roleId: ROLES.DOCTOR, enabled: true });
    await tick(2);

    expect([...room.state.enabledRoleIds]).toEqual(presetRoleIds(PRESET.CLASSIC));
    expect(room.state.rolePreset).toBe(PRESET.CLASSIC);
  });

  it("ignores settings changes once the game has started", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room);

    seats[0]!.client.send("set_preset", { preset: PRESET.CHAOS });
    seats[0]!.client.send("set_role_enabled", { roleId: ROLES.DOCTOR, enabled: true });
    await tick(2);

    expect([...room.state.enabledRoleIds]).toEqual(presetRoleIds(PRESET.CLASSIC));
    expect(room.state.rolePreset).toBe(PRESET.CLASSIC);
  });

  it("lets the host toggle an individual role, marking the preset custom", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);

    host.client.send("set_role_enabled", { roleId: ROLES.DOCTOR, enabled: true });
    await tick(2);

    expect([...room.state.enabledRoleIds]).toContain(ROLES.DOCTOR);
    expect(room.state.rolePreset).toBe(PRESET_CUSTOM);
  });

  it("refuses to disable the fill role or the last stranger-faction role", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);

    host.client.send("set_role_enabled", { roleId: ROLES.VILLAGER, enabled: false });
    host.client.send("set_role_enabled", { roleId: ROLES.STRANGER, enabled: false });
    await tick(2);

    expect([...room.state.enabledRoleIds]).toContain(ROLES.VILLAGER);
    expect([...room.state.enabledRoleIds]).toContain(ROLES.STRANGER);
    // Neither refused toggle counts as a change of settings.
    expect(room.state.rolePreset).toBe(PRESET.CLASSIC);
  });

  it("keeps the host's settings across a return to the lobby", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS; i++) {
      seats.push(await seat(room));
    }
    seats[0]!.client.send("set_preset", { preset: PRESET.CHAOS });
    await tick(2);
    readyUp(seats);
    seats[0]!.client.send("start");
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
    // This test starts the round by hand rather than through `seatAndPlay`,
    // so it has to re-gather the players itself — the round-start respawn
    // scatters them across the plaza, well out of kill range.
    gatherAtCentre(seats);

    // Drive the round to a strangers-parity win: the one stranger kills
    // two of the three others.
    const { strangers } = splitRoles(seats);
    const stranger = strangers[0]!;
    const victims = seats.filter((s) => s !== stranger).slice(0, 2);
    for (const victim of victims) {
      armAbility(room, stranger.client.sessionId, "kill");
      stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
      await tick(3);
    }
    expect(room.state.phase).toBe(PHASE.GAME_OVER);

    seats[0]!.client.send("return_to_lobby");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    expect([...room.state.enabledRoleIds]).toEqual(presetRoleIds(PRESET.CHAOS));
    expect(room.state.rolePreset).toBe(PRESET.CHAOS);
  });
});

describe("GameRoom balance settings", () => {
  it("seeds every registry setting with its default at room creation", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    for (const definition of SETTING_DEFINITIONS) {
      expect(room.state.settings.get(definition.id)).toBe(String(definition.default));
    }
  });

  it("lets the host change a setting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);

    host.client.send("set_setting", { id: "killCooldownMs", value: 15_000 });
    await tick(2);

    expect(room.state.settings.get("killCooldownMs")).toBe("15000");
  });

  it("ignores a set_setting request from a non-host", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await seat(room);
    const guest = await seat(room);
    const before = room.state.settings.get("killCooldownMs");

    guest.client.send("set_setting", { id: "killCooldownMs", value: 15_000 });
    await tick(2);

    expect(room.state.settings.get("killCooldownMs")).toBe(before);
  });

  it("ignores a set_setting request once the game has started", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room);
    const before = room.state.settings.get("killCooldownMs");

    seats[0]!.client.send("set_setting", { id: "killCooldownMs", value: 15_000 });
    await tick(2);

    expect(room.state.settings.get("killCooldownMs")).toBe(before);
  });

  it("clamps a too-high number to the setting's configured max", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);
    const definition = settingById("killCooldownMs")!;

    host.client.send("set_setting", { id: "killCooldownMs", value: definition.max! + 1_000_000 });
    await tick(2);

    expect(room.state.settings.get("killCooldownMs")).toBe(String(definition.max));
  });

  it("clamps a too-low number to the setting's configured min", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);
    const definition = settingById("killCooldownMs")!;

    host.client.send("set_setting", { id: "killCooldownMs", value: definition.min! - 1_000_000 });
    await tick(2);

    expect(room.state.settings.get("killCooldownMs")).toBe(String(definition.min));
  });

  it("rejects a wrongly-typed value, leaving the setting untouched", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);
    const before = room.state.settings.get("confirmEjects");

    host.client.send("set_setting", { id: "confirmEjects", value: "not-a-boolean" });
    await tick(2);

    expect(room.state.settings.get("confirmEjects")).toBe(before);
  });

  it("ignores an unknown setting id", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await seat(room);

    host.client.send("set_setting", { id: "notARealSetting", value: 5 });
    await tick(2);

    expect(room.state.settings.has("notARealSetting")).toBe(false);
  });

  it("assigns only the common tasks when tasksPerPlayer is set to 0", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS; i++) {
      seats.push(await seat(room));
    }
    seats[0]!.client.send("set_setting", { id: "tasksPerPlayer", value: 0 });
    await tick(2);
    readyUp(seats);
    seats[0]!.client.send("start");
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

    const commonCount = TASK_DEFINITIONS.filter((t) => t.type === "common").length;
    for (const s of seats) {
      expect(s.taskMessages[0]!.tasks).toHaveLength(commonCount);
    }
  });

  it("deals exactly the overridden stranger count, ignoring the threshold table", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < 8; i++) {
      seats.push(await seat(room));
    }
    // The Classic threshold table deals 2 strangers at 8 players; force 3.
    seats[0]!.client.send("set_setting", { id: "strangerCount", value: 3 });
    await tick(2);
    readyUp(seats);
    seats[0]!.client.send("start");
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

    const { strangers } = splitRoles(seats);
    expect(strangers).toHaveLength(3);
  });

  it("never reveals a stranger ejection when confirmEjects is turned off", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < 8; i++) {
      seats.push(await seat(room));
    }
    seats[0]!.client.send("set_setting", { id: "confirmEjects", value: false });
    await tick(2);
    readyUp(seats);
    seats[0]!.client.send("start");
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);

    const { strangers } = splitRoles(seats);
    const target = strangers[0]!;
    for (const s of seats) {
      s.client.send("vote", { targetId: target.client.sessionId });
    }
    await tick(4);

    expect(room.state.ejectedPlayerId).toBe(target.client.sessionId);
    expect(room.state.ejectionConfirmed).toBe(false);
    expect(room.state.ejectedWasStranger).toBe(false);
  });

  it("names every voter on the resolved tally once the host turns votesArePublic on", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < 8; i++) {
      seats.push(await seat(room));
    }
    seats[0]!.client.send("set_setting", { id: "votesArePublic", value: true });
    await tick(2);
    readyUp(seats);
    seats[0]!.client.send("start");
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);

    const target = seats[1]!;
    for (const s of seats) {
      s.client.send("vote", { targetId: target.client.sessionId });
    }
    await tick(4);

    // The setting actually does something: with it on, the resolved tally
    // names every one of the 8 voters. This is the positive-path sibling to
    // "publishes counts but not individual ballots when votes are anonymous"
    // below — that test pins the (unchanged) default; this one pins that the
    // toggle genuinely flips the behavior rather than being decorative.
    const tally = room.state.voteResults.get(target.client.sessionId)!;
    expect(tally.count).toBe(seats.length);
    for (const s of seats) {
      expect(tally.voterNames).toContain(s.name);
    }
  });

  it("allows a second kill sooner when killCooldownMs is tuned down", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < 8; i++) {
      seats.push(await seat(room));
    }
    // `set_setting` clamps to the production min (10s) — writing the setting
    // directly bypasses that clamp, the same way `triggerSabotage`/
    // `triggerCriticalSabotage` bypass their own ability plumbing for a short
    // test-only duration. This test is about the cooldown lookup honoring the
    // setting, not about `set_setting`'s validation, which has its own tests.
    room.state.settings.set("killCooldownMs", "500");
    readyUp(seats);
    seats[0]!.client.send("start");
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const [first, second] = townsfolk;
    for (const t of [first!, second!]) {
      t.player.x = killer.player.x;
      t.player.y = killer.player.y;
    }

    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: first!.client.sessionId });
    await tick(3);
    expect(first!.player.alive).toBe(false);
    expect(killer.abilityStateMessages.at(-1)?.cooldownMs).toBe(500);

    // Well under the default 30s cooldown, but past the tuned-down 500ms one.
    await new Promise((resolve) => setTimeout(resolve, 700));
    killer.client.send("ability", { abilityId: "kill", targetId: second!.client.sessionId });
    await tick(3);
    expect(second!.player.alive).toBe(false);
  }, 15_000);

  it("advances discussion and voting on the tuned-down schedule", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = [];
    for (let i = 0; i < MIN_PLAYERS; i++) {
      seats.push(await seat(room));
    }
    // Same direct-write override as the killCooldownMs test above — both
    // settings' production min (10s) is far longer than this test wants to
    // wait, and `set_setting` would clamp up to it.
    room.state.settings.set("discussionMs", "500");
    room.state.settings.set("votingMs", "500");
    readyUp(seats);
    seats[0]!.client.send("start");
    await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

    const caller = seats[0]!;
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.DISCUSSION);

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(room.state.meetingStage).toBe(MEETING_STAGE.VOTING);

    // Nobody votes — the tuned-down voting timer alone must resolve it.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
  }, 15_000);
});

describe("GameRoom doctor (chaos preset)", () => {
  it("deals exactly one doctor at five players, its own threshold", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 5);

    const doctors = seats.filter((s) => s.roleMessages[0]?.role === ROLES.DOCTOR);
    const { strangers } = splitRoles(seats);
    expect(doctors).toHaveLength(1);
    expect(strangers).toHaveLength(1);
  });

  it("absorbs exactly one kill, silently, then lets the next one land", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 5);
    const doctor = seatWithRole(seats, ROLES.DOCTOR);
    const stranger = seatWithRole(seats, ROLES.STRANGER);
    const victim = otherTownsfolk(seats, doctor).filter((s) => s !== stranger)[0]!;

    armAbility(room, doctor.client.sessionId, "protect");
    doctor.client.send("ability", { abilityId: "protect", targetId: victim.client.sessionId });
    await tick(3);
    // The doctor's use is spent, and the server said so.
    expect(doctor.abilityStateMessages.at(-1)?.usesLeft).toBe(0);
    // The doctor's own client sees a faint confirmation of who they shielded.
    expect(doctor.abilityEffects).toEqual([{ type: "shielded", targetId: victim.client.sessionId }]);

    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    // Absorbed: no death, no body, no confirmation — but the cooldown was
    // consumed, so the failed kill still cost the stranger their window.
    expect(victim.player.alive).toBe(true);
    expect(realBodyCount(room)).toBe(0);
    expect(stranger.killConfirmedCount).toBe(0);
    expect(stranger.abilityStateMessages.at(-1)?.cooldownMs).toBe(KILL_COOLDOWN_MS);
    // And nothing told the victim anything happened at all.
    expect(victim.killedMessages).toHaveLength(0);

    // The shield is spent: the next kill goes through.
    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);
    expect(room.state.bodies.has(victim.client.sessionId)).toBe(true);
    expect(stranger.killConfirmedCount).toBe(1);
  });

  it("rejects a doctor's second protect once their use is spent", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 5);
    const doctor = seatWithRole(seats, ROLES.DOCTOR);
    const stranger = seatWithRole(seats, ROLES.STRANGER);
    const others = otherTownsfolk(seats, doctor).filter((s) => s !== stranger);
    const first = others[0]!;
    const second = others[1]!;

    armAbility(room, doctor.client.sessionId, "protect");
    doctor.client.send("ability", { abilityId: "protect", targetId: first.client.sessionId });
    await tick(3);

    // A second protect has no uses behind it, so this target gets nothing.
    armAbility(room, doctor.client.sessionId, "protect");
    doctor.client.send("ability", { abilityId: "protect", targetId: second.client.sessionId });
    await tick(3);

    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: second.client.sessionId });
    await tick(3);
    expect(second.player.alive).toBe(false);
  });

  it("drops unspent shields when a meeting starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 5);
    const doctor = seatWithRole(seats, ROLES.DOCTOR);
    const stranger = seatWithRole(seats, ROLES.STRANGER);
    const others = otherTownsfolk(seats, doctor).filter((s) => s !== stranger);
    const victim = others[0]!;
    const caller = others[1]!;

    armAbility(room, doctor.client.sessionId, "protect");
    doctor.client.send("ability", { abilityId: "protect", targetId: victim.client.sessionId });
    await tick(3);

    // Straight into (and out of) a meeting.
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.MEETING);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);

    // The meeting scattered everyone around the Town Hall — put the killer
    // back in range of their target.
    stranger.player.x = victim.player.x;
    stranger.player.y = victim.player.y;

    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);
  });

  it("keeps the doctor out of public state and tells them no fellows", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 5);
    const doctor = seatWithRole(seats, ROLES.DOCTOR);
    const { strangers } = splitRoles(seats);

    // The settings fields legitimately name the doctor role (the lobby
    // enabled it); everything else must not.
    const { enabledRoleIds: _ids, rolePreset: _preset, ...rest } =
      room.state.toJSON() as Record<string, unknown>;
    expect(JSON.stringify(rest)).not.toContain(ROLES.DOCTOR);

    const { enabledRoleIds: _dIds, rolePreset: _dPreset, ...decodedRest } =
      strangers[0]!.client.state.toJSON() as Record<string, unknown>;
    expect(JSON.stringify(decodedRest)).not.toContain(ROLES.DOCTOR);

    // A doctor is townsfolk-faction but must never learn who anyone is.
    expect(doctor.roleMessages[0]!.fellows).toEqual([]);
  });
});

describe("GameRoom detective (chaos preset)", () => {
  it("reveals a recent witness to the body's room — possibly the killer, possibly not", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 6);
    const detective = seatWithRole(seats, ROLES.DETECTIVE);
    const stranger = seatWithRole(seats, ROLES.STRANGER);
    const others = otherTownsfolk(seats, detective).filter((s) => s !== stranger);
    const victim = others[0]!;
    const witness = others[1]!;

    const spot = TASK_ROOM_ANCHOR.tavern;
    for (const s of [victim, witness, stranger, detective]) {
      s.player.x = spot.x;
      s.player.y = spot.y;
    }
    await tick(3);

    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);

    armAbility(room, detective.client.sessionId, "investigate");
    detective.client.send("ability", { abilityId: "investigate", targetId: victim.client.sessionId });
    await tick(3);

    expect(detective.investigateHints).toHaveLength(1);
    const witnessName = detective.investigateHints[0]!.witnessName;
    // Never the detective or the victim themselves — but could genuinely be
    // either the bystander or the killer, since both were recently there.
    expect(witnessName).not.toBe(detective.name);
    expect(witnessName).not.toBe(victim.name);
    expect([witness.name, stranger.name]).toContain(witnessName);
  });

  it("still fires — with no trace found — when nobody recent turns up", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 6);
    const detective = seatWithRole(seats, ROLES.DETECTIVE);

    // A body nobody has been recorded near. A real kill can't produce this
    // scenario — the killer always ends up a valid (unexcluded) witness in
    // the same room, since they had to be right there to land it — so this
    // isolates the empty-pool branch with a direct state injection instead,
    // the same "set up state directly" pattern other tests in this file use.
    const spot = TASK_ROOM_ANCHOR.lighthouse;
    const body = new Body();
    body.playerId = "nobody";
    body.name = "Nobody";
    body.x = spot.x;
    body.y = spot.y;
    body.color = "#000000";
    room.state.bodies.set("synthetic-body", body);

    detective.player.x = spot.x;
    detective.player.y = spot.y;
    armAbility(room, detective.client.sessionId, "investigate");
    detective.client.send("ability", { abilityId: "investigate", targetId: "synthetic-body" });
    await tick(3);

    expect(detective.investigateHints).toEqual([{ witnessName: null, apparentFaction: null }]);
  });

  it("resets its one use at the next meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 6);
    const detective = seatWithRole(seats, ROLES.DETECTIVE);
    const caller = otherTownsfolk(seats, detective)[0]!;
    const stranger = seatWithRole(seats, ROLES.STRANGER);
    const victim = otherTownsfolk(seats, detective).filter((s) => s !== caller && s !== stranger)[0]!;

    const spot = TASK_ROOM_ANCHOR.docks;
    victim.player.x = spot.x;
    victim.player.y = spot.y;
    stranger.player.x = spot.x;
    stranger.player.y = spot.y;
    detective.player.x = spot.x;
    detective.player.y = spot.y;
    await tick(2);

    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);

    armAbility(room, detective.client.sessionId, "investigate");
    detective.client.send("ability", { abilityId: "investigate", targetId: victim.client.sessionId });
    await tick(3);
    expect(detective.abilityStateMessages.at(-1)?.usesLeft).toBe(0);

    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);

    expect(detective.abilityStateMessages.at(-1)?.usesLeft).toBe(1);
  });

  it("never appears in public state, and learns of no fellows", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 6);
    const detective = seatWithRole(seats, ROLES.DETECTIVE);
    const { strangers } = splitRoles(seats);

    const { enabledRoleIds: _ids, rolePreset: _preset, ...rest } =
      room.state.toJSON() as Record<string, unknown>;
    expect(JSON.stringify(rest)).not.toContain(ROLES.DETECTIVE);

    const { enabledRoleIds: _dIds, rolePreset: _dPreset, ...decodedRest } =
      strangers[0]!.client.state.toJSON() as Record<string, unknown>;
    expect(JSON.stringify(decodedRest)).not.toContain(ROLES.DETECTIVE);

    expect(detective.roleMessages[0]!.fellows).toEqual([]);
  });
});

describe("GameRoom lamplighter (chaos preset)", () => {
  it("lights the lamp: every player becomes visible for its duration, then the fog resumes", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 6);
    const lamplighter = seatWithRole(seats, ROLES.LAMPLIGHTER);
    const distant = otherTownsfolk(seats, lamplighter)[0]!;

    // Far enough apart that the fog would normally hide them from each other.
    lamplighter.player.x = 100;
    lamplighter.player.y = 100;
    distant.player.x = MAP.width - 100;
    distant.player.y = MAP.height - 100;
    await tick(3);

    // Before lighting: everyone already synced in the lobby, before the fog
    // ever applied (see the "GameRoom fog of war" suite's own doc on this) —
    // so a stale entry may legitimately exist. What must never be true is
    // that it tracks this fresh, far-away position.
    const before = lamplighter.client.state.players.get(distant.client.sessionId);
    if (before) {
      expect(Math.abs(before.x - distant.player.x)).toBeGreaterThan(200);
    }

    armAbility(room, lamplighter.client.sessionId, "light_lamp");
    lamplighter.client.send("ability", { abilityId: "light_lamp" });
    await tick(3);

    expect(room.state.lampLit).toBe(true);
    const lit = lamplighter.client.state.players.get(distant.client.sessionId);
    expect(lit).toBeDefined();
    expect(lit!.x).toBeCloseTo(distant.player.x, 3);
    expect(lit!.y).toBeCloseTo(distant.player.y, 3);

    await new Promise((resolve) => setTimeout(resolve, LAMP_DURATION_MS + 300));
    expect(room.state.lampLit).toBe(false);

    // And the fog genuinely resumes: a further move must not reach the
    // lamplighter now that the lamp is out.
    distant.player.x = 200;
    distant.player.y = 300;
    await tick(3);
    const afterDark = lamplighter.client.state.players.get(distant.client.sessionId)!;
    expect(afterDark.x).not.toBeCloseTo(distant.player.x, 0);
  });

  it("has two uses per game, not per round", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 6);
    const lamplighter = seatWithRole(seats, ROLES.LAMPLIGHTER);
    const caller = otherTownsfolk(seats, lamplighter)[0]!;

    armAbility(room, lamplighter.client.sessionId, "light_lamp");
    lamplighter.client.send("ability", { abilityId: "light_lamp" });
    await tick(2);
    expect(lamplighter.abilityStateMessages.at(-1)?.usesLeft).toBe(1);

    // A full meeting round-trip does NOT top the uses back up — lamplighter
    // is a per-game budget, unlike detective/watchman/medium.
    caller.player.x = TOWN_HALL.x;
    caller.player.y = TOWN_HALL.y;
    caller.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);
    expect(lamplighter.abilityStateMessages.at(-1)?.usesLeft).toBe(1);

    armAbility(room, lamplighter.client.sessionId, "light_lamp");
    lamplighter.client.send("ability", { abilityId: "light_lamp" });
    await tick(2);
    expect(lamplighter.abilityStateMessages.at(-1)?.usesLeft).toBe(0);

    armAbility(room, lamplighter.client.sessionId, "light_lamp");
    lamplighter.client.send("ability", { abilityId: "light_lamp" });
    await tick(2);
    // No third use, no third abilityState send.
    expect(lamplighter.abilityStateMessages).toHaveLength(4); // initial + 3 sends above minus the rejected one
  });
});

describe("GameRoom watchman (chaos preset)", () => {
  it("reveals who passed through the watched room, and nobody else", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 7);
    const watchman = seatWithRole(seats, ROLES.WATCHMAN);
    const others = otherTownsfolk(seats, watchman);
    const visitor = others[0]!;
    const stayAway = others[1]!;

    const spot = TASK_ROOM_ANCHOR.warehouse;
    watchman.player.x = spot.x;
    watchman.player.y = spot.y;
    await tick(2);

    armAbility(room, watchman.client.sessionId, "place_camera");
    watchman.client.send("ability", { abilityId: "place_camera", roomSlug: "warehouse" });
    await tick(2);

    visitor.player.x = spot.x;
    visitor.player.y = spot.y;
    await tick(3);

    watchman.player.x = TOWN_HALL.x;
    watchman.player.y = TOWN_HALL.y;
    watchman.client.send("call_meeting");
    await tick(3);

    expect(watchman.cameraReveals).toHaveLength(1);
    const reveal = watchman.cameraReveals[0]!;
    expect(reveal.roomSlug).toBe("warehouse");
    expect(reveal.names).toContain(visitor.name);
    expect(reveal.names).not.toContain(stayAway.name);
    expect(reveal.blinded).toBe(false);

    for (const s of others) {
      expect(s.cameraReveals).toHaveLength(0);
    }
  });

  it("is blinded by a sabotage instead of recording new sightings", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 7);
    const watchman = seatWithRole(seats, ROLES.WATCHMAN);
    const visitor = otherTownsfolk(seats, watchman)[0]!;

    const spot = TASK_ROOM_ANCHOR.warehouse;
    watchman.player.x = spot.x;
    watchman.player.y = spot.y;
    armAbility(room, watchman.client.sessionId, "place_camera");
    watchman.client.send("ability", { abilityId: "place_camera", roomSlug: "warehouse" });
    await tick(2);

    room.state.sabotageActive = true;
    visitor.player.x = spot.x;
    visitor.player.y = spot.y;
    await tick(3);
    room.state.sabotageActive = false;

    watchman.player.x = TOWN_HALL.x;
    watchman.player.y = TOWN_HALL.y;
    watchman.client.send("call_meeting");
    await tick(3);

    const reveal = watchman.cameraReveals[0]!;
    expect(reveal.names).not.toContain(visitor.name);
    expect(reveal.blinded).toBe(true);
  });

  it("resets the placement use at the next meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 7);
    const watchman = seatWithRole(seats, ROLES.WATCHMAN);

    armAbility(room, watchman.client.sessionId, "place_camera");
    watchman.client.send("ability", { abilityId: "place_camera", roomSlug: "warehouse" });
    await tick(2);
    expect(watchman.abilityStateMessages.at(-1)?.usesLeft).toBe(0);

    watchman.player.x = TOWN_HALL.x;
    watchman.player.y = TOWN_HALL.y;
    watchman.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);

    expect(watchman.abilityStateMessages.at(-1)?.usesLeft).toBe(1);
  });

  it("rejects a camera placed in a non-placeable room", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 7);
    const watchman = seatWithRole(seats, ROLES.WATCHMAN);

    armAbility(room, watchman.client.sessionId, "place_camera");
    watchman.client.send("ability", { abilityId: "place_camera", roomSlug: "streets" });
    await tick(2);

    // Rejected silently: no state consumed, no camera to ever reveal.
    expect(watchman.abilityStateMessages).toHaveLength(1); // only the initial arm-cooldown send
  });
});

describe("GameRoom medium (chaos preset)", () => {
  it("reveals a fact about a dead player, then falls silent once the pool is exhausted", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 7);
    const medium = seatWithRole(seats, ROLES.MEDIUM);
    const stranger = seatWithRole(seats, ROLES.STRANGER);
    const victim = otherTownsfolk(seats, medium).filter((s) => s !== stranger)[0]!;

    const spot = TASK_ROOM_ANCHOR.cellar;
    victim.player.x = spot.x;
    victim.player.y = spot.y;
    stranger.player.x = spot.x;
    stranger.player.y = spot.y;

    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);

    armAbility(room, medium.client.sessionId, "commune");
    medium.client.send("ability", { abilityId: "commune" });
    await tick(3);

    expect(medium.communeHints).toHaveLength(1);
    const hint = medium.communeHints[0];
    expect(hint).not.toBeNull();
    expect(hint!.name).toBe(victim.name);
    expect(hint!.room).toBe("cellar");
    expect(hint!.killerFaction).toBe(FACTION.STRANGER);

    // A full meeting round-trip resets the round's one use, but the pool of
    // dead players hasn't grown — the next commune comes back empty.
    medium.player.x = TOWN_HALL.x;
    medium.player.y = TOWN_HALL.y;
    medium.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);

    armAbility(room, medium.client.sessionId, "commune");
    medium.client.send("ability", { abilityId: "commune" });
    await tick(3);
    expect(medium.communeHints).toHaveLength(2);
    expect(medium.communeHints[1]).toBeNull();
  });

  it("does not surface an ejection — that's already public, not new information", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 7);
    const medium = seatWithRole(seats, ROLES.MEDIUM);
    const ejected = otherTownsfolk(seats, medium)[0]!;

    ejected.player.x = TOWN_HALL.x;
    ejected.player.y = TOWN_HALL.y;
    ejected.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", {
        targetId: s === ejected ? SKIP_VOTE : ejected.client.sessionId,
      });
    }
    await tick(4);
    expect(room.state.ejectedPlayerId).toBe(ejected.client.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);

    armAbility(room, medium.client.sessionId, "commune");
    medium.client.send("ability", { abilityId: "commune" });
    await tick(3);
    expect(medium.communeHints).toHaveLength(1);
    expect(medium.communeHints[0]).toBeNull();
  });
});

describe("GameRoom alderman (chaos preset)", () => {
  it("is rejected outside the voting stage", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 8);
    const alderman = seatWithRole(seats, ROLES.ALDERMAN);
    const target = otherTownsfolk(seats, alderman)[0]!;

    alderman.player.x = TOWN_HALL.x;
    alderman.player.y = TOWN_HALL.y;
    alderman.client.send("call_meeting");
    await tick(3);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.DISCUSSION);

    // Armed during discussion: must not take effect.
    armAbility(room, alderman.client.sessionId, "double_vote");
    alderman.client.send("ability", { abilityId: "double_vote" });
    await tick(2);

    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: s === alderman ? target.client.sessionId : SKIP_VOTE });
    }
    await tick(3);

    const tally = [...room.state.voteResults.values()].find(
      (t) => t.targetId === target.client.sessionId,
    );
    expect(tally?.count).toBe(1);
  });

  it("weighs the alderman's vote double once armed during voting, swinging the outcome", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 8);
    const alderman = seatWithRole(seats, ROLES.ALDERMAN);
    const others = otherTownsfolk(seats, alderman); // 5 people at N=8
    const strangers = splitRoles(seats).strangers; // 2 people
    const target = others[0]!;
    const rival = others[1]!;
    const targetVoters = [others[2]!, others[3]!];
    const rivalVoters = [others[4]!, strangers[0]!, strangers[1]!];

    alderman.player.x = TOWN_HALL.x;
    alderman.player.y = TOWN_HALL.y;
    alderman.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);

    armAbility(room, alderman.client.sessionId, "double_vote");
    alderman.client.send("ability", { abilityId: "double_vote" });
    await tick(2);
    expect(alderman.abilityStateMessages.at(-1)?.usesLeft).toBe(0);

    // Without the alderman, rival wins 3-2. The alderman's doubled ballot
    // for `target` is what flips the outcome.
    alderman.client.send("vote", { targetId: target.client.sessionId });
    for (const voter of targetVoters) {
      voter.client.send("vote", { targetId: target.client.sessionId });
    }
    for (const voter of rivalVoters) {
      voter.client.send("vote", { targetId: rival.client.sessionId });
    }
    target.client.send("vote", { targetId: SKIP_VOTE });
    rival.client.send("vote", { targetId: SKIP_VOTE });
    await tick(4);

    const targetTally = [...room.state.voteResults.values()].find(
      (t) => t.targetId === target.client.sessionId,
    )!;
    const rivalTally = [...room.state.voteResults.values()].find(
      (t) => t.targetId === rival.client.sessionId,
    )!;
    expect(targetTally.count).toBe(4); // 2 raw + the alderman's doubled ballot
    expect(rivalTally.count).toBe(3);
    expect(room.state.ejectedPlayerId).toBe(target.client.sessionId);
  });

  it("does not carry over to the next meeting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 8);
    const alderman = seatWithRole(seats, ROLES.ALDERMAN);
    const others = otherTownsfolk(seats, alderman);
    const secondCaller = others[0]!;
    const target = others[1]!;

    alderman.player.x = TOWN_HALL.x;
    alderman.player.y = TOWN_HALL.y;
    alderman.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    armAbility(room, alderman.client.sessionId, "double_vote");
    alderman.client.send("ability", { abilityId: "double_vote" });
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);

    // A different caller for the second meeting — the emergency bell is
    // one ring per player, and the alderman already spent theirs above.
    secondCaller.player.x = TOWN_HALL.x;
    secondCaller.player.y = TOWN_HALL.y;
    secondCaller.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);

    for (const s of seats) {
      s.client.send("vote", { targetId: s === alderman ? target.client.sessionId : SKIP_VOTE });
    }
    await tick(3);
    const tally = [...room.state.voteResults.values()].find(
      (t) => t.targetId === target.client.sessionId,
    );
    expect(tally?.count).toBe(1); // the armed flag from last meeting is gone
  });
});

describe("GameRoom constable (chaos preset)", () => {
  it("kills a Stranger cleanly, and survives", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 9);
    const constable = seatWithRole(seats, ROLES.CONSTABLE);
    const strangers = splitRoles(seats).strangers;
    const target = strangers[0]!;

    constable.player.x = TOWN_HALL.x;
    constable.player.y = TOWN_HALL.y;
    constable.client.send("call_meeting");
    await tick(3);

    armAbility(room, constable.client.sessionId, "execute_shot");
    constable.client.send("ability", { abilityId: "execute_shot", targetId: target.client.sessionId });
    await tick(3);

    expect(target.player.alive).toBe(false);
    expect(constable.player.alive).toBe(true);
    // Public immediately — everyone is already gathered, no fog to protect.
    expect([...room.state.deadPlayerIds]).toContain(target.client.sessionId);
  });

  it("kills an innocent target — and the constable too, mutually", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 9);
    const constable = seatWithRole(seats, ROLES.CONSTABLE);
    const innocent = otherTownsfolk(seats, constable)[0]!;

    constable.player.x = TOWN_HALL.x;
    constable.player.y = TOWN_HALL.y;
    constable.client.send("call_meeting");
    await tick(3);

    armAbility(room, constable.client.sessionId, "execute_shot");
    constable.client.send("ability", { abilityId: "execute_shot", targetId: innocent.client.sessionId });
    await tick(3);

    expect(innocent.player.alive).toBe(false);
    expect(constable.player.alive).toBe(false);
    expect([...room.state.deadPlayerIds]).toEqual(
      expect.arrayContaining([innocent.client.sessionId, constable.client.sessionId]),
    );
  });

  it("cannot be used outside a meeting, or once results are already resolving", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 9);
    const constable = seatWithRole(seats, ROLES.CONSTABLE);
    const target = otherTownsfolk(seats, constable)[0]!;

    // Still in open play — the ability is meeting-only.
    armAbility(room, constable.client.sessionId, "execute_shot");
    constable.client.send("ability", { abilityId: "execute_shot", targetId: target.client.sessionId });
    await tick(3);
    expect(target.player.alive).toBe(true);

    constable.player.x = TOWN_HALL.x;
    constable.player.y = TOWN_HALL.y;
    constable.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);

    // Results are already resolving — too late for a shot.
    armAbility(room, constable.client.sessionId, "execute_shot");
    constable.client.send("ability", { abilityId: "execute_shot", targetId: target.client.sessionId });
    await tick(3);
    expect(target.player.alive).toBe(true);
  });
});

describe("GameRoom sabotage (base Stranger)", () => {
  it("darkens vision town-wide while active, and restores it after the duration", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, MIN_PLAYERS);
    const { townsfolk } = splitRoles(seats);
    const [a, b] = townsfolk;

    // 120 units apart on open street — inside the normal outdoor radius
    // (170) but outside the sabotage-shrunk one (70).
    a!.player.x = 352;
    a!.player.y = 832;
    b!.player.x = 472;
    b!.player.y = 832;
    await tick(3);

    expect(a!.client.state.players.get(b!.client.sessionId)).toBeDefined();

    // The same reference-counted timer the real "sabotage"/"advanced_sabotage"
    // abilities drive, on a short duration — this test is about the vision
    // effect of `sabotageActive`, not the ability message plumbing (which the
    // "flips the shared flag" test below fires for real, on the real
    // `SABOTAGE_DURATION_MS`).
    (room as unknown as { triggerSabotage(durationMs: number): void }).triggerSabotage(600);
    expect(room.state.sabotageActive).toBe(true);

    // B moves; the fresh position must not reach A while the shrunk radius
    // excludes their real 120-unit separation.
    for (let seq = 1; seq <= 10; seq++) {
      b!.client.send("input", { seq, dir: { x: 0, y: 1 } });
    }
    await tick(6);
    const duringSabotage = a!.client.state.players.get(b!.client.sessionId);
    if (duringSabotage) {
      expect(Math.abs(duringSabotage.y - b!.player.y)).toBeGreaterThan(20);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(room.state.sabotageActive).toBe(false);

    // Vision resumes: a fresh move from B now reaches A.
    for (let seq = 11; seq <= 12; seq++) {
      b!.client.send("input", { seq, dir: { x: 0, y: -1 } });
    }
    await tick(4);
    const afterSabotage = a!.client.state.players.get(b!.client.sessionId);
    expect(afterSabotage).toBeDefined();
    expect(afterSabotage!.y).toBeCloseTo(b!.player.y, 3);
  });

  it(
    "has no target, and simply flips the shared flag on and back off",
    async () => {
      const room = await colyseus.createRoom<GameState>("game");
      const seats = await seatAndPlay(room, MIN_PLAYERS);
      const { strangers } = splitRoles(seats);
      const stranger = strangers[0]!;

      expect(room.state.sabotageActive).toBe(false);
      armAbility(room, stranger.client.sessionId, "sabotage");
      stranger.client.send("ability", { abilityId: "sabotage" });
      await tick(2);
      expect(room.state.sabotageActive).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, SABOTAGE_DURATION_MS + 2_000));
      expect(room.state.sabotageActive).toBe(false);
    },
    SABOTAGE_DURATION_MS + 10_000,
  );
});

describe("GameRoom tunnel (base Stranger)", () => {
  it("teleports the Stranger to the other fixed endpoint", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, MIN_PLAYERS);
    const { strangers } = splitRoles(seats);
    const stranger = strangers[0]!;

    stranger.player.x = TUNNEL_ENDPOINTS.cellar.x;
    stranger.player.y = TUNNEL_ENDPOINTS.cellar.y;
    await tick(2);

    armAbility(room, stranger.client.sessionId, "tunnel");
    stranger.client.send("ability", { abilityId: "tunnel" });
    await tick(3);

    expect(stranger.player.x).toBeCloseTo(TUNNEL_ENDPOINTS.tavern.x, 3);
    expect(stranger.player.y).toBeCloseTo(TUNNEL_ENDPOINTS.tavern.y, 3);
  });

  it("rejects the attempt, at no cost, when standing at neither endpoint", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, MIN_PLAYERS);
    const { strangers } = splitRoles(seats);
    const stranger = strangers[0]!;

    // Nowhere near either tunnel endpoint.
    stranger.player.x = TOWN_HALL.x;
    stranger.player.y = TOWN_HALL.y;
    const before = { x: stranger.player.x, y: stranger.player.y };
    await tick(2);

    // The initial arm-cooldown send already produced one "tunnel" message —
    // a rejected attempt must not produce a second.
    const tunnelMessagesBefore = stranger.abilityStateMessages.filter(
      (m) => m.abilityId === "tunnel",
    ).length;

    armAbility(room, stranger.client.sessionId, "tunnel");
    stranger.client.send("ability", { abilityId: "tunnel" });
    await tick(3);

    expect(stranger.player.x).toBe(before.x);
    expect(stranger.player.y).toBe(before.y);
    // A rejected attempt costs nothing — the cooldown never armed, so no new
    // abilityState message goes out.
    const tunnelMessagesAfter = stranger.abilityStateMessages.filter(
      (m) => m.abilityId === "tunnel",
    ).length;
    expect(tunnelMessagesAfter).toBe(tunnelMessagesBefore);
  });

  it("broadcasts an audible cue at both endpoints to every connected client — never fully invisible", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, MIN_PLAYERS);
    const { strangers } = splitRoles(seats);
    const stranger = strangers[0]!;
    const bystanders = seats.filter((s) => s !== stranger);

    stranger.player.x = TUNNEL_ENDPOINTS.cellar.x;
    stranger.player.y = TUNNEL_ENDPOINTS.cellar.y;
    await tick(2);

    armAbility(room, stranger.client.sessionId, "tunnel");
    stranger.client.send("ability", { abilityId: "tunnel" });
    await tick(3);

    // Unfiltered by fog — every connected client hears it, not just whoever
    // happens to be nearby. Reveals only that a sound happened at these two
    // fixed points, never who caused it.
    for (const bystander of [...bystanders, stranger]) {
      expect(bystander.tunnelSoundMessages).toHaveLength(1);
      const { points } = bystander.tunnelSoundMessages[0]!;
      expect(points).toHaveLength(2);
      const hasCellar = points.some(
        (p) =>
          Math.abs(p.x - TUNNEL_ENDPOINTS.cellar.x) < 1 && Math.abs(p.y - TUNNEL_ENDPOINTS.cellar.y) < 1,
      );
      const hasTavern = points.some(
        (p) =>
          Math.abs(p.x - TUNNEL_ENDPOINTS.tavern.x) < 1 && Math.abs(p.y - TUNNEL_ENDPOINTS.tavern.y) < 1,
      );
      expect(hasCellar).toBe(true);
      expect(hasTavern).toBe(true);
    }
  });
});

describe("GameRoom multi-ability tracking", () => {
  it("tracks each of a role's abilities on its own independent cooldown", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room, MIN_PLAYERS);
    const { strangers, townsfolk } = splitRoles(seats);
    const stranger = strangers[0]!;
    const victim = townsfolk[0]!;
    victim.player.x = stranger.player.x;
    victim.player.y = stranger.player.y;

    // Fire kill — this must not touch sabotage's or tunnel's own timers.
    armAbility(room, stranger.client.sessionId, "kill");
    stranger.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(3);
    expect(victim.player.alive).toBe(false);

    // Sabotage was never armed above, so it should still be rejected...
    stranger.client.send("ability", { abilityId: "sabotage" });
    await tick(2);
    expect(room.state.sabotageActive).toBe(false);

    // ...until it's armed on its OWN key, independent of kill's just-started
    // cooldown.
    armAbility(room, stranger.client.sessionId, "sabotage");
    stranger.client.send("ability", { abilityId: "sabotage" });
    await tick(2);
    expect(room.state.sabotageActive).toBe(true);
  });
});

describe("GameRoom shapeshifter (chaos preset)", () => {
  it("swaps the disguised player's public name and color for another client, then reverts after the duration", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 11);
    const shapeshifter = seatWithRole(seats, ROLES.SHAPESHIFTER);
    const target = seats.find((s) => s !== shapeshifter)!;
    const observer = seats.find((s) => s !== shapeshifter && s !== target)!;
    const realColor = shapeshifter.player.color;

    observer.player.x = 400;
    observer.player.y = 832;
    shapeshifter.player.x = 400;
    shapeshifter.player.y = 832;
    await tick(3);

    const before = observer.client.state.players.get(shapeshifter.client.sessionId);
    expect(before?.name).toBe(shapeshifter.name);

    armAbility(room, shapeshifter.client.sessionId, "shapeshift");
    shapeshifter.client.send("ability", {
      abilityId: "shapeshift",
      targetId: target.client.sessionId,
    });
    await tick(3);

    const during = observer.client.state.players.get(shapeshifter.client.sessionId);
    expect(during?.name).toBe(target.name);
    expect(during?.color).toBe(target.player.color);
    // The real name must not be reachable anywhere in this client's own
    // decoded state while the disguise is active — not a sibling field
    // sitting next to it, genuinely swapped.
    expect(
      [...observer.client.state.players.values()].some((p) => p.name === shapeshifter.name),
    ).toBe(false);

    // Layers a short-duration restore on top of the real ability's own
    // `SHAPESHIFT_DURATION_MS` timer. `disguiseAs` doesn't clobber an
    // existing stash (see its own doc comment), so this reuses the exact
    // pair the real fire above stashed and genuinely exercises the same
    // restore path — just on a clock that doesn't make the test wait out the
    // real duration. The real fire's own later timeout is a harmless no-op
    // once this one has already restored.
    (
      room as unknown as {
        disguiseAs(actorId: string, targetId: string, durationMs: number): void;
      }
    ).disguiseAs(shapeshifter.client.sessionId, target.client.sessionId, 400);

    await new Promise((resolve) => setTimeout(resolve, 700));
    await tick(3);

    const after = observer.client.state.players.get(shapeshifter.client.sessionId);
    expect(after?.name).toBe(shapeshifter.name);
    expect(after?.color).toBe(realColor);
  });

  it("restores the real identity immediately on death, before it reaches the body", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 11);
    const shapeshifter = seatWithRole(seats, ROLES.SHAPESHIFTER);
    const target = seats.find((s) => s !== shapeshifter)!;
    const realName = shapeshifter.name;

    armAbility(room, shapeshifter.client.sessionId, "shapeshift");
    shapeshifter.client.send("ability", {
      abilityId: "shapeshift",
      targetId: target.client.sessionId,
    });
    await tick(3);
    expect(shapeshifter.player.name).toBe(target.name);

    // The same primitive every ability's `ctx.kill` ultimately calls.
    (room as unknown as { killPlayer(v: Player, k: string): void }).killPlayer(
      shapeshifter.player,
      shapeshifter.client.sessionId,
    );

    expect(shapeshifter.player.name).toBe(realName);
    const body = room.state.bodies.get(shapeshifter.client.sessionId);
    expect(body?.name).toBe(realName);
  });

  it("restores the real identity immediately on ejection", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 11);
    const shapeshifter = seatWithRole(seats, ROLES.SHAPESHIFTER);
    const target = seats.find((s) => s !== shapeshifter)!;
    const realName = shapeshifter.name;

    armAbility(room, shapeshifter.client.sessionId, "shapeshift");
    shapeshifter.client.send("ability", {
      abilityId: "shapeshift",
      targetId: target.client.sessionId,
    });
    await tick(3);

    (room as unknown as { ejectPlayer(sessionId: string): void }).ejectPlayer(
      shapeshifter.client.sessionId,
    );

    expect(room.state.ejectedPlayerName).toBe(realName);
  });

  it("force-clears an active disguise the instant a meeting starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 11);
    const shapeshifter = seatWithRole(seats, ROLES.SHAPESHIFTER);
    const target = seats.find((s) => s !== shapeshifter)!;
    const realName = shapeshifter.name;

    armAbility(room, shapeshifter.client.sessionId, "shapeshift");
    shapeshifter.client.send("ability", {
      abilityId: "shapeshift",
      targetId: target.client.sessionId,
    });
    await tick(3);
    expect(shapeshifter.player.name).toBe(target.name);

    shapeshifter.player.x = TOWN_HALL.x;
    shapeshifter.player.y = TOWN_HALL.y;
    shapeshifter.client.send("call_meeting");
    await tick(3);

    expect(shapeshifter.player.name).toBe(realName);
  });
});

describe("GameRoom saboteur (chaos preset)", () => {
  it(
    "advanced_sabotage lasts longer than the base Stranger's own sabotage",
    async () => {
      const room = await colyseus.createRoom<GameState>("game");
      const seats = await seatChaosAndPlay(room, 13);
      const saboteur = seatWithRole(seats, ROLES.SABOTEUR);

      armAbility(room, saboteur.client.sessionId, "advanced_sabotage");
      saboteur.client.send("ability", { abilityId: "advanced_sabotage" });
      await tick(2);
      expect(room.state.sabotageActive).toBe(true);

      // Past the base Stranger's shorter duration, the Saboteur's own
      // trigger is still keeping it active.
      await new Promise((resolve) => setTimeout(resolve, SABOTAGE_DURATION_MS + 2_000));
      expect(room.state.sabotageActive).toBe(true);

      await new Promise((resolve) =>
        setTimeout(resolve, ADVANCED_SABOTAGE_DURATION_MS - SABOTAGE_DURATION_MS + 2_000),
      );
      expect(room.state.sabotageActive).toBe(false);
    },
    // Waits out the real duration difference — longer than vitest's default
    // 15s/test timeout.
    ADVANCED_SABOTAGE_DURATION_MS + 10_000,
  );

  it("lock_door blocks movement through that room's door until it expires", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 13);
    const saboteur = seatWithRole(seats, ROLES.SABOTEUR);
    const walker = seats.find((s) => s !== saboteur)!;

    // The same reference-counted lock timer the real "lock_door" ability
    // drives, on a short duration — the ability message itself (real
    // `DOOR_LOCK_DURATION_MS`, real `targetRoom` resolution) is proven
    // separately by the "fires advanced_sabotage and lock_door independently"
    // test below, which checks the immediate lock without waiting it out.
    (room as unknown as { lockDoor(room: string, durationMs: number): void }).lockDoor(
      "cellar",
      900,
    );
    expect([...room.state.lockedRoomSlugs]).toContain("cellar");

    // Just inside the cellar, one tile north of its south door — push south,
    // straight at the locked threshold.
    walker.player.x = TUNNEL_ENDPOINTS.cellar.x;
    walker.player.y = TUNNEL_ENDPOINTS.cellar.y - 32;
    for (let seq = 1; seq <= 20; seq++) {
      walker.client.send("input", { seq, dir: { x: 0, y: 1 } });
    }
    await tick(10);

    // Never reaches the door tile's row while it's locked.
    expect(walker.player.y).toBeLessThan(TUNNEL_ENDPOINTS.cellar.y - 8);

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect([...room.state.lockedRoomSlugs]).not.toContain("cellar");

    for (let seq = 21; seq <= 40; seq++) {
      walker.client.send("input", { seq, dir: { x: 0, y: 1 } });
    }
    await tick(10);
    // Now passes clean through, well past the door.
    expect(walker.player.y).toBeGreaterThan(TUNNEL_ENDPOINTS.cellar.y + 8);
  });

  it("fires advanced_sabotage and lock_door independently, each on its own cooldown", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 13);
    const saboteur = seatWithRole(seats, ROLES.SABOTEUR);

    saboteur.player.x = TASK_ROOM_ANCHOR.cellar.x;
    saboteur.player.y = TASK_ROOM_ANCHOR.cellar.y;
    await tick(2);

    armAbility(room, saboteur.client.sessionId, "lock_door");
    saboteur.client.send("ability", { abilityId: "lock_door", roomSlug: "cellar" });
    await tick(2);
    expect([...room.state.lockedRoomSlugs]).toContain("cellar");

    // advanced_sabotage was never armed — this attempt alone must not fire.
    saboteur.client.send("ability", { abilityId: "advanced_sabotage" });
    await tick(2);
    expect(room.state.sabotageActive).toBe(false);

    armAbility(room, saboteur.client.sessionId, "advanced_sabotage");
    saboteur.client.send("ability", { abilityId: "advanced_sabotage" });
    await tick(2);
    expect(room.state.sabotageActive).toBe(true);
  });
});

describe("GameRoom comms sabotage (Saboteur)", () => {
  it("blacks out comms, then restores itself after its own duration", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 13);
    const saboteur = seatWithRole(seats, ROLES.SABOTEUR);

    expect(room.state.commsSabotageActive).toBe(false);
    armAbility(room, saboteur.client.sessionId, "comms");
    saboteur.client.send("ability", { abilityId: "comms" });
    await tick(2);
    expect(room.state.commsSabotageActive).toBe(true);

    // Layers a short-duration restore on top of the real ability's own
    // `COMMS_SABOTAGE_DURATION_MS` timer — `triggerComms` isn't reference
    // counted (unlike `triggerSabotage`), so this alone flips the flag back
    // off; the real fire's own later timeout is a harmless no-op by then.
    (room as unknown as { triggerComms(durationMs: number): void }).triggerComms(400);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(room.state.commsSabotageActive).toBe(false);
  });
});

describe("GameRoom critical sabotage (Saboteur)", () => {
  /** Seat a chaos lobby at the Saboteur's own threshold and hand back the seats plus the Saboteur. */
  async function criticalSetup(room: ServerRoom<GameState>) {
    const seats = await seatChaosAndPlay(room, 13);
    const saboteur = seatWithRole(seats, ROLES.SABOTEUR);
    return { seats, saboteur };
  }

  it("starts a countdown, locks the bell, and blocks every other sabotage type while active", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, saboteur } = await criticalSetup(room);
    const other = seats.find((s) => s !== saboteur)!;

    armAbility(room, saboteur.client.sessionId, "critical_sabotage");
    saboteur.client.send("ability", { abilityId: "critical_sabotage" });
    await tick(2);

    expect(room.state.criticalSabotageActive).toBe(true);
    // Reuses the shared sabotage flag/timer — the alarm, color grade and
    // vision shrink all apply "for free".
    expect(room.state.sabotageActive).toBe(true);
    expect([...room.state.criticalRepairedPoints]).toEqual([]);

    // The bell locks — same generic rule, now exercised by critical for real.
    other.player.x = TOWN_HALL.x;
    other.player.y = TOWN_HALL.y;
    other.client.send("call_meeting");
    await tick(3);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    // Every other sabotage-family ability self-gates on criticalSabotageActive.
    armAbility(room, saboteur.client.sessionId, "advanced_sabotage");
    saboteur.client.send("ability", { abilityId: "advanced_sabotage" });
    armAbility(room, saboteur.client.sessionId, "comms");
    saboteur.client.send("ability", { abilityId: "comms" });
    armAbility(room, saboteur.client.sessionId, "lock_door");
    saboteur.client.send("ability", { abilityId: "lock_door", roomSlug: "warehouse" });
    await tick(2);
    expect(room.state.commsSabotageActive).toBe(false);
    expect([...room.state.lockedRoomSlugs]).toEqual([]);

    // A second critical trigger is rejected too — only one at a time. If it
    // had fired, it would have cleared `criticalRepairedPoints` again; it
    // stays untouched (there was nothing to clear either way, but the flag
    // simply staying `true` proves nothing new started).
    armAbility(room, saboteur.client.sessionId, "critical_sabotage");
    saboteur.client.send("ability", { abilityId: "critical_sabotage" });
    await tick(2);
    expect(room.state.criticalSabotageActive).toBe(true);
  });

  it("resolves without ending the game once both repair points are fixed", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { seats, saboteur } = await criticalSetup(room);
    const walker = seats.find((s) => s !== saboteur)!;

    armAbility(room, saboteur.client.sessionId, "critical_sabotage");
    saboteur.client.send("ability", { abilityId: "critical_sabotage" });
    await tick(2);
    expect(room.state.criticalSabotageActive).toBe(true);

    // Anyone can repair, regardless of faction — even the Saboteur themself.
    walker.player.x = CRITICAL_REPAIR_POINTS.north.x;
    walker.player.y = CRITICAL_REPAIR_POINTS.north.y;
    walker.client.send("repair_critical", { pointId: "north" });
    await tick(2);
    expect([...room.state.criticalRepairedPoints]).toEqual(["north"]);
    // Only one of two — still active.
    expect(room.state.criticalSabotageActive).toBe(true);

    // Repairing the same point again does nothing extra.
    walker.client.send("repair_critical", { pointId: "north" });
    await tick(2);
    expect([...room.state.criticalRepairedPoints]).toEqual(["north"]);

    // Too far from the south point yet — rejected.
    walker.client.send("repair_critical", { pointId: "south" });
    await tick(2);
    expect([...room.state.criticalRepairedPoints]).toEqual(["north"]);

    walker.player.x = CRITICAL_REPAIR_POINTS.south.x;
    walker.player.y = CRITICAL_REPAIR_POINTS.south.y;
    walker.client.send("repair_critical", { pointId: "south" });
    await tick(2);

    expect(room.state.criticalSabotageActive).toBe(false);
    // The town survived it — the game is not over.
    expect(room.state.phase).toBe(PHASE.PLAYING);
  });

  it("hands the Strangers the game if the countdown runs out before both points are fixed", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await criticalSetup(room);

    // Exercises the same `triggerCriticalSabotage`/timer path the real
    // ability uses, with a short duration so this doesn't have to wait out
    // the real `CRITICAL_SABOTAGE_COUNTDOWN_MS` (45s) — the scheduling logic
    // doesn't care what the duration number is.
    const started = (
      room as unknown as { triggerCriticalSabotage(durationMs: number): boolean }
    ).triggerCriticalSabotage(500);
    expect(started).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(room.state.criticalSabotageActive).toBe(false);
    expect(room.state.phase).toBe(PHASE.GAME_OVER);
    expect(room.state.winningFaction).toBe(FACTION.STRANGER);
    expect(room.state.winReason).toBe(WIN_REASON.CRITICAL_SABOTAGE);
  });
});

describe("GameRoom assassin (chaos preset)", () => {
  it("a correct guess kills the target immediately, off this meeting's ballot", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 14);
    const assassin = seatWithRole(seats, ROLES.ASSASSIN);
    const doctor = seatWithRole(seats, ROLES.DOCTOR);

    assassin.player.x = TOWN_HALL.x;
    assassin.player.y = TOWN_HALL.y;
    assassin.client.send("call_meeting");
    await tick(3);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.DISCUSSION);

    armAbility(room, assassin.client.sessionId, "assassinate");
    assassin.client.send("ability", {
      abilityId: "assassinate",
      targetId: doctor.client.sessionId,
      roleGuess: ROLES.DOCTOR,
    });
    await tick(3);

    expect(doctor.player.alive).toBe(false);
    expect(assassin.player.alive).toBe(true);
    // Public immediately — dropped from the ballot within this same meeting.
    expect([...room.state.deadPlayerIds]).toContain(doctor.client.sessionId);
  });

  it("a wrong guess ejects the assassin instead, through the normal ejection fields", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 14);
    const assassin = seatWithRole(seats, ROLES.ASSASSIN);
    const doctor = seatWithRole(seats, ROLES.DOCTOR);
    const assassinName = assassin.name;

    assassin.player.x = TOWN_HALL.x;
    assassin.player.y = TOWN_HALL.y;
    assassin.client.send("call_meeting");
    await tick(3);

    armAbility(room, assassin.client.sessionId, "assassinate");
    assassin.client.send("ability", {
      abilityId: "assassinate",
      targetId: doctor.client.sessionId,
      roleGuess: ROLES.WATCHMAN, // wrong — they're the doctor
    });
    await tick(3);

    expect(doctor.player.alive).toBe(true);
    expect(assassin.player.alive).toBe(false);
    expect(room.state.ejectedPlayerId).toBe(assassin.client.sessionId);
    expect(room.state.ejectedPlayerName).toBe(assassinName);
  });

  it("cannot be used once results are already resolving", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 14);
    const assassin = seatWithRole(seats, ROLES.ASSASSIN);
    const doctor = seatWithRole(seats, ROLES.DOCTOR);

    assassin.player.x = TOWN_HALL.x;
    assassin.player.y = TOWN_HALL.y;
    assassin.client.send("call_meeting");
    await tick(3);
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await tick(3);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);

    armAbility(room, assassin.client.sessionId, "assassinate");
    assassin.client.send("ability", {
      abilityId: "assassinate",
      targetId: doctor.client.sessionId,
      roleGuess: ROLES.DOCTOR,
    });
    await tick(3);
    expect(doctor.player.alive).toBe(true);
    expect(assassin.player.alive).toBe(true);
  });
});

describe("GameRoom silencer (chaos preset)", () => {
  it("gags the target's chat for exactly the next meeting, not the one after", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 12);
    const silencer = seatWithRole(seats, ROLES.SILENCER);
    const target = seats.find((s) => s !== silencer)!;

    armAbility(room, silencer.client.sessionId, "silence");
    silencer.client.send("ability", { abilityId: "silence", targetId: target.client.sessionId });
    await tick(2);

    // Cast during play — nothing happens to chat yet, no meeting is up.
    target.player.x = TOWN_HALL.x;
    target.player.y = TOWN_HALL.y;
    target.client.send("call_meeting");
    await tick(3);
    expect(target.silencedCount).toBe(1);

    target.client.send("chat", { text: "let me speak" });
    await tick(2);
    expect(target.chatMessages).toHaveLength(0);

    // Close this meeting out.
    openBallot(room);
    await tick(2);
    for (const s of seats) {
      s.client.send("vote", { targetId: SKIP_VOTE });
    }
    await new Promise((resolve) => setTimeout(resolve, 6200));
    expect(room.state.phase).toBe(PHASE.PLAYING);

    // A second meeting — the gag from before must not carry over. A
    // different caller rings it: each player gets only one emergency
    // meeting, and `target` already spent theirs above.
    silencer.player.x = TOWN_HALL.x;
    silencer.player.y = TOWN_HALL.y;
    silencer.client.send("call_meeting");
    await tick(3);
    target.client.send("chat", { text: "back to normal" });
    await tick(2);
    expect(target.chatMessages.some((m) => m.text === "back to normal")).toBe(true);
  });
});

describe("GameRoom decoy (chaos preset)", () => {
  it("always reads as townsfolk to the detective's investigation, regardless of real faction", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room, 10);
    const detective = seatWithRole(seats, ROLES.DETECTIVE);
    const decoy = seatWithRole(seats, ROLES.DECOY);
    expect(factionOf(ROLES.DECOY)).toBe(FACTION.STRANGER);

    // Only the decoy is ever recorded near this spot — nobody else's
    // position moves, and a synthetic body (the same injection technique
    // the "no trace found" test uses) sidesteps needing a real kill, which
    // would otherwise put the killer in the same candidate pool too.
    const spot = TASK_ROOM_ANCHOR.lighthouse;
    decoy.player.x = spot.x;
    decoy.player.y = spot.y;
    await tick(3);

    const body = new Body();
    body.playerId = "nobody";
    body.name = "Nobody";
    body.x = spot.x;
    body.y = spot.y;
    body.color = "#000000";
    room.state.bodies.set("synthetic-body", body);

    detective.player.x = spot.x;
    detective.player.y = spot.y;
    armAbility(room, detective.client.sessionId, "investigate");
    detective.client.send("ability", { abilityId: "investigate", targetId: "synthetic-body" });
    await tick(3);

    expect(detective.investigateHints).toHaveLength(1);
    const hint = detective.investigateHints[0]!;
    expect(hint.witnessName).toBe(decoy.name);
    expect(hint.apparentFaction).toBe(FACTION.TOWNSFOLK);
  });
});

describe("GameRoom account auth + bans", () => {
  it("refuses a banned account at join — the ban chokepoint", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const banned = await authProvider.seedUser({
      username: "Cheater",
      email: "cheater@example.com",
      banned: true,
      banReason: "cheating",
    });
    const token = authProvider.tokenFor(banned.id);

    await expect(
      colyseus.connectTo(room, { token, name: "whatever", intent: "join" }),
    ).rejects.toMatchObject({ code: JOIN_ERROR.BANNED });
    // And they never took a seat.
    expect(room.state.players.size).toBe(0);
  });

  it("lets a banned account back in once the ban is lifted", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    // A seated player keeps the (otherwise-empty) room alive across the
    // rejected attempt below — an empty room disposes, which is a test-harness
    // artifact, not the behavior under test.
    await colyseus.connectTo(room, { name: "Keeper", intent: "join" });

    const user = await authProvider.seedUser({
      username: "Reformed",
      email: "reformed@example.com",
      banned: true,
      banReason: "spam",
    });
    const token = authProvider.tokenFor(user.id);
    await expect(colyseus.connectTo(room, { token })).rejects.toMatchObject({
      code: JOIN_ERROR.BANNED,
    });

    // A fresh lookup happens on every join, so lifting the ban takes effect
    // immediately with the same token.
    await authProvider.seedUser({
      id: user.id,
      username: "Reformed",
      email: "reformed@example.com",
      banned: false,
    });
    await expect(colyseus.connectTo(room, { token })).resolves.toBeDefined();
  });

  it("treats an expired temporary ban as lifted", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const user = await authProvider.seedUser({
      username: "Timeout",
      email: "timeout@example.com",
      banned: true,
      banReason: "cooldown",
      banUntil: new Date(Date.now() - 60_000), // already in the past
    });
    await expect(
      colyseus.connectTo(room, { token: authProvider.tokenFor(user.id) }),
    ).resolves.toBeDefined();
  });

  it("uses the account's username as the display name, ignoring a spoofed name", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const user = await authProvider.seedUser({
      username: "RealName",
      email: "real@example.com",
    });

    const client = await colyseus.connectTo(room, {
      token: authProvider.tokenFor(user.id),
      name: "Impostor", // a registered player can't rename themselves at join
      intent: "join",
    });
    await tick(2);

    expect(room.state.players.get(client.sessionId)!.name).toBe("RealName");
  });

  it("rejects a malformed/expired token rather than silently guesting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await expect(
      colyseus.connectTo(room, { token: "not-a-real-jwt", intent: "join" }),
    ).rejects.toMatchObject({ code: JOIN_ERROR.AUTH_INVALID });
  });

  it("lets a guest join a room but never create one", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    // Keeper keeps the room alive across the rejected create attempt.
    await colyseus.connectTo(room, { name: "Keeper", intent: "join" });

    // A guest CREATE is refused...
    await expect(
      colyseus.connectTo(room, { name: "Guesty", intent: "create" }),
    ).rejects.toMatchObject({ code: JOIN_ERROR.GUEST_NO_CREATE });

    // ...but a guest JOIN is fine.
    const client = await colyseus.connectTo(room, { name: "Guesty", intent: "join" });
    await tick(2);
    expect(room.state.players.get(client.sessionId)!.name).toBe("Guesty");
  });

  it("refuses a join from someone the host has blocked", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await authProvider.seedUser({ username: "Host", email: "host@example.com" });
    const blocked = await authProvider.seedUser({
      username: "Blocked",
      email: "blocked@example.com",
    });
    await colyseus.connectTo(room, { token: authProvider.tokenFor(host.id), intent: "create" });

    friendProvider.seedBlock(host.id, blocked.id);

    await expect(
      colyseus.connectTo(room, { token: authProvider.tokenFor(blocked.id), intent: "join" }),
    ).rejects.toMatchObject({ code: JOIN_ERROR.BLOCKED });
    expect(room.state.players.size).toBe(1);
  });

  it("refuses a join from someone who blocked the host, not just the reverse", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await authProvider.seedUser({ username: "Host2", email: "host2@example.com" });
    const blocker = await authProvider.seedUser({
      username: "Blocker",
      email: "blocker@example.com",
    });
    await colyseus.connectTo(room, { token: authProvider.tokenFor(host.id), intent: "create" });

    // The blocking direction is the other way round from the previous test.
    friendProvider.seedBlock(blocker.id, host.id);

    await expect(
      colyseus.connectTo(room, { token: authProvider.tokenFor(blocker.id), intent: "join" }),
    ).rejects.toMatchObject({ code: JOIN_ERROR.BLOCKED });
  });

  it("lets an unrelated account join a room a block exists elsewhere in", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await authProvider.seedUser({ username: "Host3", email: "host3@example.com" });
    const stranger = await authProvider.seedUser({
      username: "Stranger1",
      email: "stranger1@example.com",
    });
    const somebodyElse = await authProvider.seedUser({
      username: "Elsewhere",
      email: "elsewhere@example.com",
    });
    await colyseus.connectTo(room, { token: authProvider.tokenFor(host.id), intent: "create" });

    // A block between two accounts that has nothing to do with this room.
    friendProvider.seedBlock(stranger.id, somebodyElse.id);

    const client = await colyseus.connectTo(room, {
      token: authProvider.tokenFor(somebodyElse.id),
      intent: "join",
    });
    await tick(2);
    expect(room.state.players.has(client.sessionId)).toBe(true);
  });

  it("guests are exempt from the host block check on both sides", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await authProvider.seedUser({ username: "Host4", email: "host4@example.com" });
    await colyseus.connectTo(room, { token: authProvider.tokenFor(host.id), intent: "create" });

    const guest = await colyseus.connectTo(room, { name: "Passerby", intent: "join" });
    await tick(2);
    expect(room.state.players.has(guest.sessionId)).toBe(true);
  });
});
