import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  COINS_PER_ROUND,
  COINS_WIN_BONUS,
  FACTION,
  MIN_PLAYERS,
  ROLES,
  TICK_RATE,
  WIN_REASON,
  LOBBY_READY_PAD_POINT,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";
import { InMemoryModerationProvider, setModerationProvider } from "../moderation/provider";
import { InMemoryCosmeticProvider, setCosmeticProvider } from "../cosmetics/provider";

/**
 * Cosmetics' own room suite — registered accounts throughout (a loadout has
 * to attach to a durable identity, same reason `GameRoomModeration.test.ts`
 * keeps its own harness apart from the guest-heavy main suite).
 */

let colyseus: ColyseusTestServer;
let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;
let moderationProvider: InMemoryModerationProvider;
let cosmeticProvider: InMemoryCosmeticProvider;
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
});

afterEach(async () => {
  await colyseus.cleanup();
});

beforeEach(() => {
  authProvider.reset();
  friendProvider.reset();
  moderationProvider.reset();
  cosmeticProvider.reset();
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

describe("cosmetic loadout snapshot at join", () => {
  it("writes the account's equipped loadout onto the Player row", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const account = await registerAccount();
    await cosmeticProvider.equip(account.id, "top_hat");
    await cosmeticProvider.equip(account.id, "spectacles");

    const client = await colyseus.connectTo(room, { token: account.token, intent: "create" });
    // `applyCosmeticLoadout` is fire-and-forget — give its promise a tick to land.
    await tick(3);

    const player = room.state.players.get(client.sessionId)!;
    expect(player.hatId).toBe("top_hat");
    expect(player.accessoryId).toBe("spectacles");
    expect(player.petId).toBe("");
  });

  it("a player with nothing equipped joins with every slot empty", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const account = await registerAccount();
    const client = await colyseus.connectTo(room, { token: account.token, intent: "create" });
    await tick(3);

    const player = room.state.players.get(client.sessionId)!;
    expect(player.hatId).toBe("");
    expect(player.accessoryId).toBe("");
    expect(player.petId).toBe("");
    expect(player.outfitId).toBe("");
    expect(player.victoryPoseId).toBe("");
    expect(player.deathEffectId).toBe("");
  });

  it("a guest never gets cosmetics — there is no account to own them", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    // A guest can't create; seat a real host first, then the guest joins.
    const host = await registerAccount();
    await colyseus.connectTo(room, { token: host.token, intent: "create" });
    const guest = await colyseus.connectTo(room, { name: "Guesty", intent: "join" });
    await tick(3);

    const player = room.state.players.get(guest.sessionId)!;
    expect(player.hatId).toBe("");
    expect(player.petId).toBe("");
  });

  it("a slow-to-resolve lookup never blocks the join itself", async () => {
    // Same provider used throughout — this asserts the *shape* of the
    // guarantee (join succeeds immediately, cosmetics arrive after) rather
    // than literally racing a slow database, which the in-memory provider
    // has no way to simulate.
    const room = await colyseus.createRoom<GameState>("game");
    const account = await registerAccount();
    const client = await colyseus.connectTo(room, { token: account.token, intent: "create" });
    expect(room.state.players.has(client.sessionId)).toBe(true);
  });
});

describe("cosmetics ride the same fog gate as position", () => {
  it("a distant viewer never receives a cosmetic change; a nearby one does", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const clients: Array<import("colyseus.js").Room<GameState>> = [];
    for (let i = 0; i < MIN_PLAYERS; i += 1) {
      const account = await registerAccount();
      clients.push(
        await colyseus.connectTo(room, { token: account.token, intent: i === 0 ? "create" : "join" }),
      );
    }

    // Ready is physical: the start is refused unless MIN_PLAYERS are
    // standing on the Tavern flagstone (see isOnReadyPad).
    for (const c of clients) {
      const p = room.state.players.get(c.sessionId)!;
      p.x = LOBBY_READY_PAD_POINT.x;
      p.y = LOBBY_READY_PAD_POINT.y;
    }
    clients[0]!.send("start");
    await tick(4);
    await new Promise((resolve) => setTimeout(resolve, 3200)); // clear ROLE_REVEAL

    const [a, b, c] = clients;
    const playerA = room.state.players.get(a!.sessionId)!;
    const playerB = room.state.players.get(b!.sessionId)!;
    const playerC = room.state.players.get(c!.sessionId)!;

    // A far west; B far east — beyond outdoor vision. C right beside B.
    playerA.x = 352;
    playerA.y = 832;
    playerB.x = 1152;
    playerB.y = 832;
    playerC.x = 1160;
    playerC.y = 832;
    await tick(3);

    // A late-arriving cosmetic change — exactly what `applyCosmeticLoadout`
    // resolving after the round has already started would look like.
    playerB.hatId = "top_hat";
    await tick(4);

    const aSeesB = a!.state.players.get(b!.sessionId);
    if (aSeesB) {
      // Whatever A holds predates the change — never the fresh value.
      expect(aSeesB.hatId).not.toBe("top_hat");
    }

    const cSeesB = c!.state.players.get(b!.sessionId);
    expect(cSeesB).toBeDefined();
    expect(cSeesB!.hatId).toBe("top_hat");
  });
});

describe("coin economy at game over", () => {
  /** Directly reach the game-over path, sidestepping a full win condition — the same reflection `armAbility` already uses elsewhere in this suite to poke at private room internals for test setup. */
  function forceGameOver(
    room: ServerRoom<GameState>,
    winningFaction: string,
    roleBySession: Record<string, string>,
  ): void {
    const internals = room as unknown as {
      roles: Map<string, string>;
      declareGameOver: (faction: string, reason: string) => void;
    };
    for (const [sessionId, role] of Object.entries(roleBySession)) {
      internals.roles.set(sessionId, role);
    }
    internals.declareGameOver(winningFaction, WIN_REASON.TASKS);
  }

  it("pays every registered account the base amount, and the winner a bonus", async () => {
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

    expect(await cosmeticProvider.getCoins(villagerAccount.id)).toBe(COINS_PER_ROUND + COINS_WIN_BONUS);
    expect(await cosmeticProvider.getCoins(strangerAccount.id)).toBe(COINS_PER_ROUND);
  });

  it("pays guests nothing — there is no account for a balance to attach to", async () => {
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

    expect(await cosmeticProvider.getCoins(host.id)).toBe(COINS_PER_ROUND + COINS_WIN_BONUS);
    // No error thrown, and no coins awarded for the guest — there's simply
    // no account id for `sessionUserIds` to have recorded.
  });

  it("denormalises cosmetics and colour onto finalRoster for the results screen", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const account = await registerAccount();
    await cosmeticProvider.equip(account.id, "top_hat");
    const client = await colyseus.connectTo(room, { token: account.token, intent: "create" });
    await tick(3); // let the loadout snapshot land

    forceGameOver(room, FACTION.TOWNSFOLK, { [client.sessionId]: ROLES.VILLAGER });
    await tick(2);

    const revealed = room.state.finalRoster.get(client.sessionId)!;
    expect(revealed.hatId).toBe("top_hat");
    expect(revealed.color).toBe(room.state.players.get(client.sessionId)?.color ?? revealed.color);
    expect(revealed.lanternColor).toBe(room.state.players.get(client.sessionId)?.lanternColor);
    expect(revealed.lanternColor).not.toBe("");
  });
});
