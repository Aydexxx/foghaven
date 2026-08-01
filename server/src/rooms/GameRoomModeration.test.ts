import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  CHAT_BURST_MAX,
  CHAT_COOLDOWN_MS,
  CHAT_REPEAT_MAX,
  JOIN_ERROR,
  MIN_PLAYERS,
  PHASE,
  REPORT_RATE_MAX,
  REPORT_REASON,
  ROLE_REVEAL_MS,
  TICK_RATE,
  TOWN_HALL,
  type ChatMessage,
  LOBBY_READY_PAD_POINT,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";
import { InMemoryModerationProvider, setModerationProvider } from "../moderation/provider";

/**
 * Moderation's own room suite, kept apart from `GameRoom.test.ts` because it
 * needs a different arrangement: registered accounts (a report has to attach
 * to a durable identity) and an installed moderation store, where that suite
 * runs almost entirely on tokenless guests.
 */

let colyseus: ColyseusTestServer;
let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;
let moderationProvider: InMemoryModerationProvider;
let seatCount = 0;

beforeAll(async () => {
  process.env.BCRYPT_COST = "4";
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  moderationProvider = new InMemoryModerationProvider();
  setModerationProvider(moderationProvider);

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
});

afterEach(async () => {
  await colyseus.cleanup();
  authProvider.reset();
  friendProvider.reset();
  moderationProvider.reset();
  seatCount = 0;
});

function tick(count: number): Promise<void> {
  const ms = (1000 / TICK_RATE) * count + 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a chat message and wait out the per-message cooldown.
 *
 * Necessary because the cooldown drops anything sent inside it *silently* and
 * before the spam limiter ever sees it — so a test that fires faster than this
 * measures the cooldown, not the burst budget it means to be testing.
 */
async function sendChat(
  speaker: { client: { send(type: string, message: unknown): void } },
  text: string,
): Promise<void> {
  speaker.client.send("chat", { text });
  await new Promise((resolve) => setTimeout(resolve, CHAT_COOLDOWN_MS + 60));
}

/**
 * Seat a player holding a real account — reports need one on both ends, so
 * unlike the main suite's guest seats every player here is registered.
 */
async function seat(room: ServerRoom<GameState>, options: { name?: string; intent?: string } = {}) {
  const name = options.name ?? `Tester${++seatCount}`;
  const user = await authProvider.seedUser({
    username: name,
    email: `${name.toLowerCase()}@example.com`,
  });
  moderationProvider.registerUser({ id: user.id, username: name });

  const client = await colyseus.connectTo(room, {
    token: authProvider.tokenFor(user.id),
    intent: options.intent ?? "join",
  });

  const chatMessages: ChatMessage[] = [];
  client.onMessage("chat", (message: ChatMessage) => chatMessages.push(message));

  const chatRejections: Array<{ reason: string; mutedUntil?: number }> = [];
  client.onMessage("chatRejected", (message: { reason: string; mutedUntil?: number }) =>
    chatRejections.push(message),
  );

  const reportAcks: Array<{ ok: boolean; error?: string }> = [];
  client.onMessage("reportAck", (message: { ok: boolean; error?: string }) =>
    reportAcks.push(message),
  );

  return {
    client,
    userId: user.id,
    name,
    get player() {
      return room.state.players.get(client.sessionId)!;
    },
    chatMessages,
    chatRejections,
    reportAcks,
  };
}

/**
 * Start a round and open a meeting, which is the only state in which the
 * living chat channel accepts anything. Goes through the ordinary start flow
 * so these tests exercise the same path a real game takes.
 */
async function meetingRoom(room: ServerRoom<GameState>, count = MIN_PLAYERS) {
  const seats = [];
  for (let i = 0; i < count; i += 1) {
    seats.push(await seat(room, { intent: i === 0 ? "create" : "join" }));
  }
  // Ready is physical: the start is refused unless MIN_PLAYERS are
  // standing on the Tavern flagstone (see isOnReadyPad).
  for (const s of seats) {
    s.player.x = LOBBY_READY_PAD_POINT.x;
    s.player.y = LOBBY_READY_PAD_POINT.y;
  }
  seats[0]!.client.send("start");
  await tick(4);
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

  const caller = seats[0]!;
  caller.player.x = TOWN_HALL.x;
  caller.player.y = TOWN_HALL.y;
  caller.client.send("call_meeting");
  await tick(3);
  expect(room.state.phase).toBe(PHASE.MEETING);
  return seats;
}

describe("chat filter", () => {
  it("masks ordinary profanity but still delivers the message", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);

    seats[1]!.client.send("chat", { text: "that was a shit play" });
    await tick(4);

    const delivered = seats[2]!.chatMessages.at(-1);
    expect(delivered?.text).toBe("that was a **** play");
    expect(delivered?.text).not.toContain("shit");
  });

  it("refuses a slur outright and tells the sender why", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);
    const listener = seats[2]!;
    const before = listener.chatMessages.length;

    seats[1]!.client.send("chat", { text: "you faggot" });
    await tick(4);

    expect(listener.chatMessages.length).toBe(before);
    expect(seats[1]!.chatRejections.at(-1)?.reason).toBe("blocked");
  });

  it("catches a spaced-out evasion the same way", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);

    seats[1]!.client.send("chat", { text: "f u c k this" });
    await tick(4);

    expect(seats[2]!.chatMessages.at(-1)?.text).not.toContain("f u c k");
  });

  it("leaves ordinary conversation completely alone", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);

    seats[1]!.client.send("chat", { text: "I was in electrical the whole time" });
    await tick(4);

    expect(seats[2]!.chatMessages.at(-1)?.text).toBe("I was in electrical the whole time");
    expect(seats[1]!.chatRejections).toHaveLength(0);
  });
});

describe("spam limits", () => {
  it("mutes a player who floods past the burst budget", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);
    const spammer = seats[1]!;

    // Each message distinct, so this is the burst rule under test rather than
    // the repeat rule, and paced past the per-message cooldown so that is not
    // what trips first.
    for (let i = 0; i < CHAT_BURST_MAX + 3; i += 1) {
      await sendChat(spammer, `flooding message number ${i}`);
    }
    await tick(2);

    expect(spammer.chatRejections.some((r) => r.reason === "rate_limited")).toBe(true);

    // And they are now muted: a perfectly innocent follow-up is refused too.
    const listener = seats[2]!;
    const before = listener.chatMessages.length;
    spammer.client.send("chat", { text: "let me back in" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before);
    expect(spammer.chatRejections.at(-1)?.reason).toBe("muted");
  });

  it("mutes a player repeating the same line", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);
    const spammer = seats[1]!;

    for (let i = 0; i < CHAT_REPEAT_MAX + 2; i += 1) {
      await sendChat(spammer, "VOTE RED");
    }
    await tick(2);

    expect(spammer.chatRejections.some((r) => r.reason === "rate_limited")).toBe(true);
  });

  it("does not punish a normal back-and-forth", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);
    const speaker = seats[1]!;

    for (const text of ["where was everyone", "I was in electrical", "red is sus"]) {
      await sendChat(speaker, text);
    }
    await tick(2);

    expect(speaker.chatRejections).toHaveLength(0);
    expect(seats[2]!.chatMessages.map((m) => m.text)).toContain("red is sus");
  });
});

describe("mute", () => {
  it("the host can mute and then unmute a player", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);
    const host = seats[0]!;
    const target = seats[1]!;
    const listener = seats[2]!;
    expect(room.state.hostId).toBe(host.client.sessionId);

    host.client.send("mute", { targetId: target.client.sessionId });
    await tick(2);

    let before = listener.chatMessages.length;
    target.client.send("chat", { text: "am I still here" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before);
    expect(target.chatRejections.at(-1)?.reason).toBe("muted");

    host.client.send("mute", { targetId: target.client.sessionId, muted: false });
    await tick(2);
    before = listener.chatMessages.length;
    target.client.send("chat", { text: "back again" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before + 1);
  });

  it("a non-host cannot mute anyone", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);
    const pretender = seats[1]!;
    const target = seats[2]!;
    const listener = seats[3]!;

    pretender.client.send("mute", { targetId: target.client.sessionId });
    await tick(2);

    const before = listener.chatMessages.length;
    target.client.send("chat", { text: "still talking" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before + 1);
  });

  it("vote-mute carries once a majority of the others agree", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room, 6);
    const target = seats[5]!;
    const listener = seats[1]!;

    // Five others, so three agreeing is the majority that carries.
    for (const voter of seats.slice(0, 3)) {
      voter.client.send("vote_mute", { targetId: target.client.sessionId });
      await tick(2);
    }
    await tick(2);

    const before = listener.chatMessages.length;
    target.client.send("chat", { text: "why can nobody hear me" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before);
    expect(target.chatRejections.at(-1)?.reason).toBe("muted");
  });

  it("a single vote silences nobody", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room, 6);
    const target = seats[5]!;
    const listener = seats[1]!;

    seats[1]!.client.send("vote_mute", { targetId: target.client.sessionId });
    await tick(3);

    const before = listener.chatMessages.length;
    target.client.send("chat", { text: "I am still talking" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before + 1);
  });

  it("one player cannot stack a vote-mute by voting repeatedly", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room, 6);
    const target = seats[5]!;
    const listener = seats[1]!;

    // Ballots are a set keyed by voter, so the same person voting five times
    // is still exactly one vote.
    for (let i = 0; i < 5; i += 1) {
      seats[1]!.client.send("vote_mute", { targetId: target.client.sessionId });
      await tick(1);
    }
    await tick(2);

    const before = listener.chatMessages.length;
    target.client.send("chat", { text: "one voter is not a majority" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before + 1);
  });

  it("cannot be used against the host", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room, 6);
    const host = seats[0]!;
    const listener = seats[1]!;

    for (const voter of seats.slice(1)) {
      voter.client.send("vote_mute", { targetId: host.client.sessionId });
      await tick(1);
    }
    await tick(2);

    const before = listener.chatMessages.length;
    host.client.send("chat", { text: "still hosting" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before + 1);
  });

  it("respects the host's voteMuteEnabled setting", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room, 6);
    room.state.settings.set("voteMuteEnabled", "false");
    await tick(2);

    const target = seats[5]!;
    const listener = seats[1]!;
    for (const voter of seats.slice(0, 4)) {
      voter.client.send("vote_mute", { targetId: target.client.sessionId });
      await tick(1);
    }
    await tick(2);

    const before = listener.chatMessages.length;
    target.client.send("chat", { text: "vote mute is off" });
    await tick(3);
    expect(listener.chatMessages.length).toBe(before + 1);
  });
});

describe("reports", () => {
  it("files a report that lands in the moderation store", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const troll = await seat(room, { name: "Troll", intent: "create" });
    const reporter = await seat(room, { name: "Ada" });
    await tick(2);

    reporter.client.send("report", {
      targetId: troll.client.sessionId,
      reason: REPORT_REASON.HARASSMENT,
      note: "abusive all game",
    });
    await tick(4);

    expect(reporter.reportAcks.at(-1)?.ok).toBe(true);
    const reports = await moderationProvider.listReports(null, 10);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.reportedId).toBe(troll.userId);
    expect(reports[0]!.reporterId).toBe(reporter.userId);
    expect(reports[0]!.reason).toBe(REPORT_REASON.HARASSMENT);
    expect(reports[0]!.note).toBe("abusive all game");
    expect(reports[0]!.roomCode).toBe(room.roomId);
  });

  it("attaches the surrounding chat as evidence", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);
    const troll = seats[1]!;

    troll.client.send("chat", { text: "something worth reporting" });
    await tick(4);

    seats[0]!.client.send("report", {
      targetId: troll.client.sessionId,
      reason: REPORT_REASON.HARASSMENT,
    });
    await tick(4);

    const reports = await moderationProvider.listReports(null, 10);
    expect(reports[0]!.chatExcerpt.map((line) => line.text)).toContain(
      "something worth reporting",
    );
  });

  it("records a blocked slur in the chat log even though it was never delivered", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);

    seats[1]!.client.send("chat", { text: "you faggot" });
    await tick(4);

    const log = await moderationProvider.listChatLog(room.roomId, 50);
    const blocked = log.find((entry) => entry.text.includes("faggot"));
    expect(blocked).toBeDefined();
    expect(blocked!.filtered).toBe(true);
  });

  it("attributes logged chat to the sender's account", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await meetingRoom(room);

    seats[1]!.client.send("chat", { text: "a perfectly ordinary line" });
    await tick(4);

    const log = await moderationProvider.listChatLog(room.roomId, 50);
    const entry = log.find((line) => line.text === "a perfectly ordinary line");
    expect(entry?.userId).toBe(seats[1]!.userId);
  });

  it("refuses a report against a guest, who has no account to act on", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const reporter = await seat(room, { name: "Ada", intent: "create" });
    const guest = await colyseus.connectTo(room, { name: "Guesty", intent: "join" });
    await tick(2);

    reporter.client.send("report", {
      targetId: guest.sessionId,
      reason: REPORT_REASON.HARASSMENT,
    });
    await tick(3);

    expect(reporter.reportAcks.at(-1)).toMatchObject({ ok: false, error: "invalid" });
    expect(await moderationProvider.listReports(null, 10)).toHaveLength(0);
  });

  it("refuses a self-report or an invented reason", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const reporter = await seat(room, { name: "Ada", intent: "create" });
    await tick(2);

    reporter.client.send("report", {
      targetId: reporter.client.sessionId,
      reason: REPORT_REASON.HARASSMENT,
    });
    await tick(2);
    expect(reporter.reportAcks.at(-1)).toMatchObject({ ok: false, error: "invalid" });

    reporter.client.send("report", { targetId: "someone", reason: "because-i-said-so" });
    await tick(2);
    expect(reporter.reportAcks.at(-1)).toMatchObject({ ok: false, error: "invalid" });
    expect(await moderationProvider.listReports(null, 10)).toHaveLength(0);
  });

  it("rate-limits a reporter flooding the queue", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const troll = await seat(room, { name: "Troll", intent: "create" });
    const reporter = await seat(room, { name: "Ada" });
    await tick(2);

    for (let i = 0; i < REPORT_RATE_MAX + 3; i += 1) {
      reporter.client.send("report", {
        targetId: troll.client.sessionId,
        reason: REPORT_REASON.SPAM,
      });
      await tick(1);
    }
    await tick(3);

    expect(reporter.reportAcks.some((ack) => ack.error === "rate_limited")).toBe(true);
    expect((await moderationProvider.listReports(null, 50)).length).toBeLessThanOrEqual(
      REPORT_RATE_MAX,
    );
  });
});

describe("bans issued by moderators reach the room", () => {
  it("a banned account cannot join, using the same token that worked before", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    await colyseus.connectTo(room, { name: "Keeper", intent: "join" });

    const troll = await authProvider.seedUser({
      username: "Troll",
      email: "troll@example.com",
    });
    const token = authProvider.tokenFor(troll.id);
    await expect(colyseus.connectTo(room, { token })).resolves.toBeDefined();

    // What the admin panel's ban endpoint does to the user row. `onAuth`
    // re-reads that row on every join, so the next attempt is refused.
    await authProvider.seedUser({
      id: troll.id,
      username: "Troll",
      email: "troll@example.com",
      banned: true,
      banReason: "harassment",
    });

    await expect(colyseus.connectTo(room, { token })).rejects.toMatchObject({
      code: JOIN_ERROR.BANNED,
    });
  });
});
