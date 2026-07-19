import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  INPUT_RATE,
  MAP,
  MIN_PLAYERS,
  PHASE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  ROLES,
  ROLE_REVEAL_MS,
  type RoleAssignment,
  SIM_DT,
  strangerCount,
  TICK_RATE,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";

/** Distance a single legitimate input command is allowed to move a player. */
const STEP = PLAYER_SPEED * SIM_DT;

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  const gameServer = new Server({ transport: new WebSocketTransport({}) });
  gameServer.define("game", GameRoom);
  colyseus = await boot(gameServer);
});

afterAll(async () => {
  await colyseus.shutdown();
});

afterEach(async () => {
  await colyseus.cleanup();
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

  return { client, player, name, roleMessages };
}

/** Seat `count` players and start the game as the host, returning every seat. */
async function seatAndStart(room: ServerRoom<GameState>, count = MIN_PLAYERS) {
  const seats = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  seats[0]!.client.send("start");
  await tick(4);
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

  it("clamps position to the map bounds on the server", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    // Start a couple of steps from the top-left corner so the wall is reachable
    // within the server's input budget.
    const { client, player } = await seat(room, {
      at: { x: PLAYER_RADIUS + STEP * 2, y: PLAYER_RADIUS + STEP * 2 },
    });

    for (let seq = 1; seq <= 30; seq++) {
      client.send("input", { seq, dir: { x: -1, y: -1 } });
    }
    await tick(30);

    expect(player.x).toBeGreaterThanOrEqual(PLAYER_RADIUS);
    expect(player.y).toBeGreaterThanOrEqual(PLAYER_RADIUS);
    expect(player.x).toBeLessThanOrEqual(MAP.width - PLAYER_RADIUS);
    expect(player.y).toBeLessThanOrEqual(MAP.height - PLAYER_RADIUS);
    expect(player.x).toBeCloseTo(PLAYER_RADIUS, 5);
    expect(player.y).toBeCloseTo(PLAYER_RADIUS, 5);
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

    seats[1]!.client.send("start");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    expect(seats.every((s) => s.roleMessages.length === 0)).toBe(true);
  });

  it("ignores a start request below the minimum player count", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const { client: host, roleMessages } = await seat(room);

    // Below MIN_PLAYERS — only the host is seated.
    host.send("start");
    await tick(3);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    expect(roleMessages).toHaveLength(0);
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

  it("locks the room once the game starts", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await seatAndStart(room);

    // A late joiner would have no role and would have missed the reveal.
    await expect(colyseus.connectTo(room, { name: "Latecomer" })).rejects.toThrow();
    expect(room.state.players.size).toBe(MIN_PLAYERS);
  });
});

describe("strangerCount", () => {
  it("scales with the player count per the shared config table", () => {
    expect([4, 5, 6].map(strangerCount)).toEqual([1, 1, 1]);
    expect([7, 8, 9].map(strangerCount)).toEqual([2, 2, 2]);
    expect([10, 11, 16].map(strangerCount)).toEqual([3, 3, 3]);
  });
});

describe("GameRoom role assignment", () => {
  it("tells every player exactly one role, and only their own", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room);

    for (const s of seats) {
      expect(s.roleMessages).toHaveLength(1);
      expect([ROLES.STRANGER, ROLES.TOWNSFOLK]).toContain(s.roleMessages[0]!.role);
    }
  });

  it("deals the configured number of strangers", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room, 8);

    const strangers = seats.filter((s) => s.roleMessages[0]!.role === ROLES.STRANGER);
    expect(strangers).toHaveLength(strangerCount(8));
  });

  it("lets strangers see each other but never themselves", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room, 8);

    const strangers = seats.filter((s) => s.roleMessages[0]!.role === ROLES.STRANGER);
    const strangerNames = strangers.map((s) => s.name);

    for (const s of strangers) {
      const fellows = s.roleMessages[0]!.fellowStrangers;
      expect([...fellows].sort()).toEqual(strangerNames.filter((n) => n !== s.name).sort());
      expect(fellows).not.toContain(s.name);
    }
  });

  it("tells townsfolk nothing about anyone else", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndStart(room, 8);

    const townsfolk = seats.filter((s) => s.roleMessages[0]!.role === ROLES.TOWNSFOLK);
    expect(townsfolk.length).toBeGreaterThan(0);

    for (const s of townsfolk) {
      const message = s.roleMessages[0]!;
      expect(message.fellowStrangers).toEqual([]);

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

    const publicState = JSON.stringify(room.state.toJSON());
    expect(publicState).not.toContain(ROLES.STRANGER);
    expect(publicState).not.toContain(ROLES.TOWNSFOLK);

    room.state.players.forEach((player) => {
      expect(player).not.toHaveProperty("role");
    });

    // And the same holds for the state a townsfolk actually decoded off the
    // wire — this object was built purely from bytes their socket received.
    const townsfolk = seats.find((s) => s.roleMessages[0]!.role === ROLES.TOWNSFOLK)!;
    const decoded = JSON.stringify(townsfolk.client.state.toJSON());
    expect(decoded).not.toContain(ROLES.STRANGER);
    expect(decoded).not.toContain(ROLES.TOWNSFOLK);
  });
});
