import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import { FACTION, ROLES, TICK_RATE, WIN_REASON, type GameSummaryMessage } from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";
import { InMemoryModerationProvider, setModerationProvider } from "../moderation/provider";
import { InMemoryCosmeticProvider, setCosmeticProvider } from "../cosmetics/provider";
import { InMemoryStatsProvider, setStatsProvider } from "../stats/provider";

/**
 * The stats system's own room suite — registered accounts throughout (a stat
 * line has to attach to a durable identity), same reasoning as
 * `GameRoomCosmetics.test.ts` for keeping its own harness apart from the
 * guest-heavy main suite.
 */

let colyseus: ColyseusTestServer;
let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;
let moderationProvider: InMemoryModerationProvider;
let cosmeticProvider: InMemoryCosmeticProvider;
let statsProvider: InMemoryStatsProvider;
let seatCount = 0;

beforeAll(async () => {
  process.env.BCRYPT_COST = "4";
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  moderationProvider = new InMemoryModerationProvider();
  setModerationProvider(moderationProvider);
  cosmeticProvider = new InMemoryCosmeticProvider();
  setCosmeticProvider(cosmeticProvider);
  statsProvider = new InMemoryStatsProvider();
  setStatsProvider(statsProvider);

  const gameServer = new Server({ transport: new WebSocketTransport({}) });
  gameServer.define("game", GameRoom);

  // Same ephemeral-port workaround as `GameRoom.test.ts` — see its comment.
  await gameServer.listen(0);
  const address = (gameServer.transport.server as import("net").Server).address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  (gameServer as unknown as { port: number }).port = port;

  colyseus = new ColyseusTestServer(gameServer);
});

afterAll(async () => {
  if (colyseus) {
    await colyseus.shutdown();
  }
  setAuthProvider(null);
  setFriendProvider(null);
  setModerationProvider(null);
  setCosmeticProvider(null);
  setStatsProvider(null);
});

afterEach(async () => {
  await colyseus.cleanup();
});

beforeEach(() => {
  authProvider.reset();
  friendProvider.reset();
  moderationProvider.reset();
  cosmeticProvider.reset();
  statsProvider.reset();
  seatCount = 0;
});

function tick(count: number): Promise<void> {
  const ms = (1000 / TICK_RATE) * count + 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerAccount(username?: string) {
  const name = username ?? `Tester${++seatCount}`;
  const user = await authProvider.seedUser({ username: name, email: `${name.toLowerCase()}@example.com` });
  return { id: user.id, username: name, token: authProvider.tokenFor(user.id) };
}

interface RoomInternals {
  roles: Map<string, string>;
  tasks: Map<string, Map<string, { totalSteps: number; completedSteps: number }>>;
  gameStartedAt: number;
  declareGameOver: (faction: string, reason: string) => void;
}

/**
 * Directly reach the game-over path, the same reflection trick
 * `GameRoomCosmetics.test.ts` uses — sidesteps a full win condition and lets
 * a test seed task progress and a game-start time without actually running
 * the clock out.
 */
function forceGameOver(
  room: ServerRoom<GameState>,
  winningFaction: string,
  roleBySession: Record<string, string>,
  options: {
    tasksBySession?: Record<string, { totalSteps: number; completedSteps: number }>;
    startedAgoMs?: number;
  } = {},
): void {
  const internals = room as unknown as RoomInternals;
  for (const [sessionId, role] of Object.entries(roleBySession)) {
    internals.roles.set(sessionId, role);
  }
  internals.gameStartedAt = Date.now() - (options.startedAgoMs ?? 0);
  if (options.tasksBySession) {
    for (const [sessionId, task] of Object.entries(options.tasksBySession)) {
      internals.tasks.set(sessionId, new Map([["task1", task]]));
    }
  }
  internals.declareGameOver(winningFaction, WIN_REASON.TASKS);
}

describe("stats recorded at game over", () => {
  it("records a game for every registered account, with the winner's faction marked won", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const villagerAccount = await registerAccount("Villager1");
    const strangerAccount = await registerAccount("Stranger1");
    const villager = await colyseus.connectTo(room, { token: villagerAccount.token, intent: "create" });
    const stranger = await colyseus.connectTo(room, { token: strangerAccount.token, intent: "join" });
    await tick(2);

    forceGameOver(room, FACTION.TOWNSFOLK, {
      [villager.sessionId]: ROLES.VILLAGER,
      [stranger.sessionId]: ROLES.STRANGER,
    });
    await tick(3);

    const villagerStats = await statsProvider.getStats(villagerAccount.id);
    expect(villagerStats.gamesPlayed).toBe(1);
    expect(villagerStats.gamesWon).toBe(1);
    expect(villagerStats.roleStats).toEqual([{ role: ROLES.VILLAGER, gamesPlayed: 1, gamesWon: 1 }]);

    const strangerStats = await statsProvider.getStats(strangerAccount.id);
    expect(strangerStats.gamesPlayed).toBe(1);
    expect(strangerStats.gamesWon).toBe(0);
  });

  it("skips guests — there is no account for a stat line to attach to", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const host = await registerAccount();
    const hostClient = await colyseus.connectTo(room, { token: host.token, intent: "create" });
    const guest = await colyseus.connectTo(room, { name: "Guesty", intent: "join" });
    await tick(2);

    forceGameOver(room, FACTION.TOWNSFOLK, {
      [hostClient.sessionId]: ROLES.VILLAGER,
      [guest.sessionId]: ROLES.VILLAGER,
    });
    await tick(3);

    expect((await statsProvider.getStats(host.id)).gamesPlayed).toBe(1);
    // No error thrown for the guest, and nothing recorded under any id for them.
  });

  it("counts completed task steps and elapsed survival time", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const account = await registerAccount();
    const client = await colyseus.connectTo(room, { token: account.token, intent: "create" });
    await tick(2);

    forceGameOver(
      room,
      FACTION.TOWNSFOLK,
      { [client.sessionId]: ROLES.VILLAGER },
      {
        tasksBySession: { [client.sessionId]: { totalSteps: 5, completedSteps: 3 } },
        startedAgoMs: 45_000,
      },
    );
    await tick(3);

    const stats = await statsProvider.getStats(account.id);
    expect(stats.tasksCompleted).toBe(3);
    expect(stats.totalSurvivalTimeMs).toBeGreaterThanOrEqual(45_000);
    // A player still alive at the end counts as having survived the round.
    expect(stats.gamesSurvived).toBe(1);
  });

  it("resets the game clock and death record between rounds", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const account = await registerAccount();
    const client = await colyseus.connectTo(room, { token: account.token, intent: "create" });
    await tick(2);

    forceGameOver(
      room,
      FACTION.TOWNSFOLK,
      { [client.sessionId]: ROLES.VILLAGER },
      { startedAgoMs: 60_000 },
    );
    await tick(3);
    (room as unknown as { handleReturnToLobby: (c: unknown) => void }).handleReturnToLobby({
      sessionId: client.sessionId,
    });
    await tick(2);

    expect((room as unknown as { gameStartedAt: number }).gameStartedAt).toBe(0);
    expect((room as unknown as { diedAt: Map<string, number> }).diedAt.size).toBe(0);
  });
});

describe("end-of-game summary broadcast", () => {
  it("tells every client who did what, including task progress", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const account = await registerAccount();
    const client = await colyseus.connectTo(room, { token: account.token, intent: "create" });
    await tick(2);

    const summaryPromise = new Promise<GameSummaryMessage>((resolve) => {
      client.onMessage<GameSummaryMessage>("gameSummary", resolve);
    });

    forceGameOver(
      room,
      FACTION.TOWNSFOLK,
      { [client.sessionId]: ROLES.VILLAGER },
      { tasksBySession: { [client.sessionId]: { totalSteps: 4, completedSteps: 2 } } },
    );

    const summary = await summaryPromise;
    const entry = summary.players.find((p) => p.id === client.sessionId);
    expect(entry).toMatchObject({
      role: ROLES.VILLAGER,
      faction: FACTION.TOWNSFOLK,
      survived: true,
      tasksCompleted: 2,
      tasksTotal: 4,
    });
    expect(summary.voteRounds).toEqual([]);
  });
});
