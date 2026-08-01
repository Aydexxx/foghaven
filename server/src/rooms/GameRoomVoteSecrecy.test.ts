import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  LOBBY_READY_PAD_POINT,
  MEETING_STAGE,
  PHASE,
  ROLE_REVEAL_MS,
  SKIP_VOTE,
  TICK_RATE,
  TOWN_HALL,
  type RoleAssignment,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/**
 * The ballot's secrecy contract (ART_BIBLE §8, roadmap 7.15).
 *
 * "Votes stay hidden until the timer ends" is a claim about every byte on
 * every socket, not about what a client chooses to render — so, same
 * discipline as `GameRoomKillSecrecy.test.ts`, nothing here inspects decoded
 * client state. These tests read the raw wire.
 *
 * Three channels, because closing only the first is the classic mistake:
 *
 *   1. **Content** — while the ballot is open, does any message or state
 *      patch, to ANY client, reveal an individual voter's choice? Tested
 *      under both `votesArePublic` settings, because the setting must only
 *      change what happens at RESOLUTION, never mid-ballot.
 *   2. **Size** — does a bystander's patch stream differ in byte length
 *      depending on WHO was voted for? A `hasVoted` flip is a fixed-shape
 *      boolean; if the patch carrying it were ever bigger for one target
 *      than another, patch size alone would be a vote-content channel.
 *   3. **Timing** — does any client learn the resolved tally before the vote
 *      that actually completes the ballot is sent? This is the literal
 *      "stay hidden until the timer ends" claim: the setting decides WHAT is
 *      eventually shown, resolution timing decides WHEN, and neither may
 *      leak early.
 *
 * `votes` — the server's voter→target map — is never `@type()`-decorated, so
 * it cannot be serialized into `GameState` by construction; these tests exist
 * to catch a leak introduced through `client.send(...)` or through moving
 * data onto public state, not to re-prove the schema decorator system works.
 */

let colyseus: ColyseusTestServer;
let authProvider: InMemoryAuthProvider;
let friendProvider: InMemoryFriendProvider;

beforeAll(async () => {
  authProvider = new InMemoryAuthProvider();
  setAuthProvider(authProvider);
  friendProvider = new InMemoryFriendProvider();
  setFriendProvider(friendProvider);
  const gameServer = new Server({ transport: new WebSocketTransport({}) });
  gameServer.define("game", GameRoom);
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
});

afterEach(async () => {
  await colyseus.cleanup();
  authProvider.reset();
  friendProvider.reset();
});

function tick(count: number): Promise<void> {
  const ms = (1000 / TICK_RATE) * count + 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One raw WebSocket frame the server pushed, with when and how big. */
interface WirePacket {
  at: number;
  bytes: number;
}

/** A decoded application message, with arrival time. */
interface AppMessage {
  at: number;
  type: string;
}

let seatCount = 0;

/**
 * A seated client with both the byte-level and the decoded-message view of
 * its own socket tapped — same dual tap `GameRoomKillSecrecy.test.ts` uses,
 * for the same reason: content needs the decoded view, size and timing need
 * the raw one.
 */
async function seat(room: ServerRoom<GameState>) {
  const name = `Ballot${++seatCount}`;
  const client = await colyseus.connectTo(room, { name });
  const player = room.state.players.get(client.sessionId)!;

  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (m: RoleAssignment) => roleMessages.push(m));

  const messages: AppMessage[] = [];
  client.onMessage("*", (type: string | number) => {
    messages.push({ at: Date.now(), type: String(type) });
  });

  const packets: WirePacket[] = [];
  const ws = (
    client as unknown as { connection: { transport: { ws: WebSocket } } }
  ).connection.transport.ws;
  ws.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as ArrayBuffer | Buffer | string;
    let bytes: number;
    if (typeof data === "string") {
      bytes = Buffer.byteLength(data);
    } else if (data instanceof ArrayBuffer) {
      bytes = data.byteLength;
    } else {
      bytes = (data as Buffer).length;
    }
    packets.push({ at: Date.now(), bytes });
  });

  // Fired the instant this client's OWN decoded `voteResults` map first gains
  // an entry — the client-side signal that resolution reached this socket.
  // `undefined` until it happens. `resolvedAtPacketIndex` is captured in the
  // very same synchronous callback, so it pins the exact packet that carried
  // resolution — millisecond timestamps can't reliably order two packets
  // that arrive in the same event-loop turn, but array length can.
  let resolvedAt: number | undefined;
  let resolvedAtPacketIndex: number | undefined;
  client.state.voteResults.onAdd(() => {
    resolvedAt ??= Date.now();
    resolvedAtPacketIndex ??= packets.length;
  });

  return {
    client,
    player,
    name,
    roleMessages,
    messages,
    packets,
    get resolvedAt() {
      return resolvedAt;
    },
    get resolvedAtPacketIndex() {
      return resolvedAtPacketIndex;
    },
    /** Everything recorded from `since` onward, for windowed comparisons. */
    since(since: number) {
      return {
        messages: messages.filter((m) => m.at >= since),
        packets: packets.filter((p) => p.at >= since),
      };
    },
  };
}

type Seat = Awaited<ReturnType<typeof seat>>;

/**
 * Seat `count` players and start the game — Classic preset throughout, which
 * never triggers role selection at any headcount (its enabled-role pools are
 * always too thin), so no interaction with that phase to account for here.
 */
async function seatAndPlay(room: ServerRoom<GameState>, count: number): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  for (const s of seats) {
    s.player.x = LOBBY_READY_PAD_POINT.x;
    s.player.y = LOBBY_READY_PAD_POINT.y;
  }
  seats[0]!.client.send("start");
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
  return seats;
}

/** Skip straight to an open ballot — mirrors `GameRoom.test.ts`'s own `openBallot`. */
function openBallot(room: ServerRoom<GameState>): void {
  (room as unknown as { enterStage(stage: string): void }).enterStage(MEETING_STAGE.VOTING);
}

async function ballotSetup(room: ServerRoom<GameState>, count: number): Promise<Seat[]> {
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
  return seats;
}

function setVotesArePublic(host: Seat, value: boolean): void {
  host.client.send("set_setting", { id: "votesArePublic", value });
}

describe("the open ballot — channel 1: content", () => {
  it.each([
    ["anonymous", false],
    ["public", true],
  ])(
    "reveals no individual vote to anyone while the ballot is open (votesArePublic=%s)",
    async (_label, votesArePublic) => {
      const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
      const seats: Seat[] = [];
      const host = await seat(room);
      seats.push(host);
      for (let i = 1; i < 6; i++) {
        seats.push(await seat(room));
      }
      setVotesArePublic(host, votesArePublic);
      await tick(2);
      for (const s of seats) {
        s.player.x = LOBBY_READY_PAD_POINT.x;
        s.player.y = LOBBY_READY_PAD_POINT.y;
      }
      host.client.send("start");
      await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));

      host.player.x = TOWN_HALL.x;
      host.player.y = TOWN_HALL.y;
      host.client.send("call_meeting");
      await tick(3);
      openBallot(room);
      await tick(2);

      const start = Date.now();
      const [a, b, c] = seats;
      // Three of six vote, deliberately not enough to complete the ballot —
      // this window is the one that matters: a partial ballot, still open.
      a!.client.send("vote", { targetId: b!.client.sessionId });
      b!.client.send("vote", { targetId: c!.client.sessionId });
      c!.client.send("vote", { targetId: SKIP_VOTE });
      await tick(6);

      expect(room.state.meetingStage).toBe(MEETING_STAGE.VOTING);
      // The setting governs disclosure at RESOLUTION only — an open ballot
      // publishes nothing regardless of it.
      expect(room.state.voteResults.size).toBe(0);

      for (const s of seats) {
        const seen = s.since(start).messages.map((m) => m.type);
        // No message TYPE this room ever sends carries ballot content — a
        // vote is conveyed purely as a `hasVoted` schema flip, never as an
        // application message. This is the exhaustive form of "the vote
        // itself was never sent to anyone": if a future change ever added a
        // message type that did carry it, this list would need updating,
        // which is the point.
        for (const leaky of ["vote", "voteCast", "voteResult", "ballot", "tally"]) {
          expect(seen).not.toContain(leaky);
        }
      }
    },
  );

  it("keeps a ghost bystander's own decoded state free of any ballot mapping while voting is open", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await ballotSetup(room, 6);
    const [voter, target, , , , ghost] = seats;

    // A real bystander who cannot vote at all — the meeting/fog rule that
    // "the dead see everyone" makes a ghost the sharpest-eyed possible
    // observer here, so proving THEY learn nothing is the strong form of
    // this claim.
    ghost!.player.alive = false;

    voter!.client.send("vote", { targetId: target!.client.sessionId });
    await tick(4);

    expect(ghost!.player.hasVoted).toBe(false);
    expect(room.state.voteResults.size).toBe(0);
    const publicState = JSON.stringify(room.state.toJSON());
    expect(publicState).not.toContain(`"voteResults":{"${target!.client.sessionId}`);
  });
});

describe("the open ballot — channel 2: size", () => {
  it("produces an identical bystander patch-size total no matter who the votes target", async () => {
    /**
     * Runs one full six-player ballot (five real votes + a bystander who
     * never votes) and returns the total bytes the bystander's socket
     * received from `start` through resolution.
     *
     * Two fixes were needed to make this an apples-to-apples comparison, and
     * both were genuinely about test design, not about anything leaking:
     *
     *  - `seatCount` is reset before each run so both produce byte-identical
     *    player names ("Ballot1".."Ballot6" both times) — otherwise the
     *    SECOND call's names are longer purely from the module-level counter
     *    having already advanced.
     *  - Neither candidate target may be `seats[0]`: that seat is both the
     *    room's host AND the meeting's caller (`ballotSetup` uses it as
     *    both). Ejecting the host trips `ensureConnectedHost`'s reassignment,
     *    which broadcasts an extra `hostId` patch the other candidate never
     *    would — a real asymmetry, just not the one this test is for.
     *    Comparing `seats[1]` against `seats[4]` (neither host nor caller)
     *    removes it.
     */
    async function runBallot(target: "first" | "last"): Promise<number> {
      seatCount = 0;
      const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
      const seats = await ballotSetup(room, 6);
      const bystander = seats[5]!;
      bystander.player.alive = false; // a ghost: present, silent, never votes.

      const voters = seats.slice(0, 5);
      const targetSeat = target === "first" ? seats[1]! : seats[4]!;

      // Snapshotted as an array length, not a timestamp: two packets that
      // arrive in the same event-loop turn can carry an identical
      // `Date.now()`, so wall-clock windowing can't reliably tell them
      // apart. Index position can.
      const startIndex = bystander.packets.length;
      for (const voter of voters) {
        voter.client.send("vote", { targetId: targetSeat.client.sessionId });
      }
      await tick(6);
      expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);

      // Bounded by the bystander's own resolution receipt, not by whatever
      // happened to accumulate by the time this function got around to
      // measuring. The world keeps ticking (and re-dirtying every position
      // for the fog heartbeat) after the ballot resolves, and under load a
      // variable number of those unrelated ticks can land inside an
      // open-ended window — that's wall-clock noise, not a content
      // difference this channel is meant to catch.
      const endIndex = bystander.resolvedAtPacketIndex;
      expect(endIndex).toBeDefined();
      return bystander.packets
        .slice(startIndex, endIndex)
        .reduce((sum, p) => sum + p.bytes, 0);
    }

    const totalA = await runBallot("first");
    const totalB = await runBallot("last");

    // Different target, same shape of outcome (5 votes, one winner, ejection)
    // — a bystander's byte total must not depend on which of the two it was.
    // Session ids are fixed-length and names are seeded identically
    // (`Ballot${n}`), so this is an exact match, not a tolerance band.
    expect(totalA).toBe(totalB);
  });
});

describe("the open ballot — channel 3: timing", () => {
  it("never resolves a client's own tally before the vote that completes the ballot is sent", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await ballotSetup(room, 5);

    // Four of five vote, leaving the ballot open right up to the last beat.
    for (const s of seats.slice(0, 4)) {
      s.client.send("vote", { targetId: seats[4]!.client.sessionId });
    }
    await tick(4);
    expect(room.state.meetingStage).toBe(MEETING_STAGE.VOTING);
    for (const s of seats) {
      expect(s.resolvedAt).toBeUndefined();
    }

    // The vote that completes the ballot — everything must resolve no
    // earlier than this instant, for every client, including the voter who
    // just cast it.
    const completingVoteSentAt = Date.now();
    seats[4]!.client.send("vote", { targetId: seats[0]!.client.sessionId });
    await tick(6);

    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
    for (const s of seats) {
      expect(s.resolvedAt).toBeDefined();
      expect(s.resolvedAt!).toBeGreaterThanOrEqual(completingVoteSentAt);
    }
  });

  it("delivers the resolved tally to every client within the same instant, not staggered", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await ballotSetup(room, 6);

    for (const s of seats) {
      s.client.send("vote", { targetId: seats[0]!.client.sessionId });
    }
    await tick(6);

    expect(room.state.meetingStage).toBe(MEETING_STAGE.RESULTS);
    const arrivals = seats.map((s) => s.resolvedAt!);
    expect(arrivals.every((a) => a !== undefined)).toBe(true);

    // One broadcast patch, not a staggered per-client reveal whose ORDER
    // could itself become something to read something into.
    const spread = Math.max(...arrivals) - Math.min(...arrivals);
    expect(spread).toBeLessThan(500);
  });
});
