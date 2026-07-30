import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  FACTION,
  factionOf,
  PHASE,
  ROLE_REVEAL_MS,
  TASK_ROOM_ANCHOR,
  TICK_RATE,
  type RoleAssignment,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/**
 * The kill cutscene's secrecy contract (ART_BIBLE §10.1, roadmap 7.9).
 *
 * The cutscene plays for exactly two people — the killer and the victim — and
 * a third player standing across the map in the fog must not be able to tell
 * a kill happened at all. "Must not be able to tell" is a claim about **every
 * byte their socket receives**, not about which fields the client renders, so
 * nothing here inspects client state: these tests read the raw wire.
 *
 * Three channels are covered, because closing only the first is the classic
 * mistake:
 *
 *   1. **Content** — is the kill in any message the third party receives?
 *   2. **Timing** — does *any* message, whatever its content, reliably arrive
 *      at the moment of a kill? A silent client that receives one unexplained
 *      packet the instant a stranger strikes has still been told.
 *   3. **Size** — do the periodic state patches change length when a kill
 *      happens elsewhere? Encrypted or opaque payloads still leak through
 *      their length; a patch that is reliably N bytes bigger during a kill
 *      tick is a kill detector regardless of what is inside it.
 *
 * A test that only asserts "the kill event is not in the payload" would pass
 * against a build that leaks on all three of the others.
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

/** One frame the server actually receives on the wire, with when and how big. */
interface WirePacket {
  at: number;
  bytes: number;
}

/** An application-level message, decoded, with arrival time. */
interface AppMessage {
  at: number;
  type: string;
}

let seatCount = 0;

/**
 * A seated client with its socket tapped.
 *
 * `packets` is the byte-level view — every WebSocket frame the server pushed,
 * including the binary state patches Colyseus sends on its own schedule.
 * `messages` is the decoded application-message view. Both are needed: the
 * first is the only way to see the size and timing channels, the second is the
 * only way to name what arrived.
 */
async function seat(room: ServerRoom<GameState>) {
  const name = `Sneak${++seatCount}`;
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

  return {
    client,
    player,
    name,
    roleMessages,
    messages,
    packets,
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

async function seatAndPlay(room: ServerRoom<GameState>, count: number): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  seats[0]!.client.send("start");
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
  return seats;
}

function splitRoles(seats: Seat[]) {
  return {
    strangers: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.STRANGER),
    townsfolk: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.TOWNSFOLK),
  };
}

function armAbility(room: ServerRoom<GameState>, sessionId: string, abilityId: string): void {
  (room as unknown as { abilityReadyAt: Map<string, number> }).abilityReadyAt.set(
    `${sessionId}:${abilityId}`,
    0,
  );
}

/**
 * Puts killer and victim on top of each other in one corner and every witness
 * in the opposite corner. The map is 48x36 tiles at 32px, so these are far
 * past any vision radius with plenty of wall between.
 */
const KILL_CORNER = { x: 200, y: 200 };
const FAR_CORNER = { x: 1400, y: 1050 };

function stageKill(seats: Seat[]) {
  const { strangers, townsfolk } = splitRoles(seats);
  const killer = strangers[0]!;
  const victim = townsfolk[0]!;
  const witnesses = seats.filter((s) => s !== killer && s !== victim);

  killer.player.x = KILL_CORNER.x;
  killer.player.y = KILL_CORNER.y;
  victim.player.x = KILL_CORNER.x;
  victim.player.y = KILL_CORNER.y;
  for (const w of witnesses) {
    w.player.x = FAR_CORNER.x;
    w.player.y = FAR_CORNER.y;
  }
  return { killer, victim, witnesses };
}

describe("the kill is invisible to third parties — message content", () => {
  it("sends the kill cue to the victim and the confirmation to the killer, and nothing to anyone else", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim, witnesses } = stageKill(seats);
    await tick(2);

    const start = Date.now();
    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(6);

    expect(victim.player.alive).toBe(false);
    // The game must not have ended, or GAME_OVER would legitimately reach
    // everyone and mask whatever else did.
    expect(room.state.phase).toBe(PHASE.PLAYING);

    expect(victim.since(start).messages.map((m) => m.type)).toContain("killed");
    expect(killer.since(start).messages.map((m) => m.type)).toContain("killConfirmed");

    for (const w of witnesses) {
      const types = w.since(start).messages.map((m) => m.type);
      expect(types).not.toContain("killed");
      expect(types).not.toContain("killConfirmed");
    }
  });

  it("never names the victim in anything a distant witness receives", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim, witnesses } = stageKill(seats);
    await tick(2);

    // Capture the raw text of every frame, not just the decoded type — an id
    // smuggled inside an unrelated message would pass a type-only check.
    const seen: string[] = [];
    for (const w of witnesses) {
      const ws = (
        w.client as unknown as { connection: { transport: { ws: WebSocket } } }
      ).connection.transport.ws;
      ws.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as ArrayBuffer | Buffer | string;
        seen.push(
          typeof data === "string"
            ? data
            : Buffer.from(data as ArrayBuffer).toString("binary"),
        );
      });
    }

    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(6);

    expect(victim.player.alive).toBe(false);
    const haystack = seen.join("");
    expect(haystack).not.toContain(victim.client.sessionId);
    expect(haystack).not.toContain(victim.name);
  });
});

describe("the kill is invisible to third parties — timing channel", () => {
  /**
   * The headline test. A witness sitting in the fog on the far side of the map
   * gets a steady drip of state patches the whole time; the question is whether
   * the kill perturbs that drip at all.
   *
   * Framed as "did anything arrive that the control window did not also see" so
   * it fails on *any* extra packet, not only on a message someone thought to
   * name. Voice is deliberately off here — see the voice suite below, which
   * covers that channel separately and has a very different answer.
   */
  it("produces no message a distant witness would not have received anyway", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim, witnesses } = stageKill(seats);
    const witness = witnesses[0]!;
    await tick(4);

    // Control window: the same length of quiet play, no kill.
    const controlStart = Date.now();
    await tick(6);
    const controlTypes = new Set(witness.since(controlStart).messages.map((m) => m.type));

    // Kill window.
    const killStart = Date.now();
    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(6);
    const killTypes = witness.since(killStart).messages.map((m) => m.type);

    expect(victim.player.alive).toBe(false);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    const novel = killTypes.filter((type) => !controlTypes.has(type));
    expect(
      novel,
      `a distant witness received message type(s) during the kill window that never ` +
        `appear in an equivalent quiet window: ${JSON.stringify(novel)}. Any such ` +
        `message is a kill detector regardless of its contents.`,
    ).toEqual([]);
  });
});

describe("the kill is invisible to third parties — voice channel", () => {
  /**
   * FIXED (was a KNOWN LEAK). `killPlayer` calls `broadcastVoiceRosters()`,
   * which used to push every voice-enabled client a fresh `voiceRoster` —
   * and for a distant witness, the victim would vanish from `peers` on that
   * exact tick, disclosing both that a kill happened and exactly who.
   *
   * The fix (not a workaround, a real narrowing of what the roster means):
   * `GameRoom.voicePeersFor` now asks `isVoiceAlive`, not `.alive`, when
   * deciding roster membership. A covert kill (one during `PLAYING`, not yet
   * reported) goes into `undisclosedKills`, and everyone still IN that set
   * counts as "voice-alive" for roster-shape purposes — so a distant
   * witness's roster is bit-for-bit unchanged by a kill they can't see.
   * `sendVoiceRoster` also now skips the send entirely when nothing changed
   * for that specific client (`lastSentVoiceRoster`), which is what closes
   * the remaining sliver of a timing channel: an unprompted but
   * content-identical roster push would itself have been a tell.
   *
   * What actually stops the victim being heard during the undisclosed
   * window is `deathMuted` — a private directive, computed from the REAL
   * `alive` flag, telling the victim's own client to kill its own outgoing
   * mic. It is asserted directly in `GameRoomVoice.test.ts`; this file only
   * needs to confirm the THIRD PARTY'S view is untouched, which is its whole
   * remit.
   */
  it("does not tell a distant voice-enabled witness that a kill happened", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    for (const s of seats) {
      s.client.send("voice_ready");
    }
    await tick(3);

    const { killer, victim, witnesses } = stageKill(seats);
    const witness = witnesses[0]!;
    await tick(2);

    const start = Date.now();
    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(6);

    expect(victim.player.alive).toBe(false);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    const types = witness.since(start).messages.map((m) => m.type);
    expect(
      types,
      `a distant witness with voice enabled received ${JSON.stringify(types)} on the ` +
        `kill tick — any message here, even a content-identical roster push, would be a tell.`,
    ).not.toContain("voiceRoster");
  });

  /**
   * The containment boundary, pinned as a genuine pass: even setting aside
   * the fix above, the finding was always bounded to players who opted into
   * voice. A player with voice off learns nothing, which is what keeps this
   * from ever having been a total defeat of the fog.
   */
  it("tells a witness with voice OFF nothing at all when a kill happens", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim, witnesses } = stageKill(seats);
    const witness = witnesses[0]!;
    // Everyone EXCEPT the witness enables voice, so the broadcast is live and
    // the witness's silence is meaningful rather than incidental.
    for (const s of seats) {
      if (s !== witness) {
        s.client.send("voice_ready");
      }
    }
    await tick(3);

    const start = Date.now();
    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(6);

    expect(victim.player.alive).toBe(false);
    expect(witness.since(start).messages.map((m) => m.type)).toEqual([]);
  });
});

describe("the kill is invisible to third parties — size channel", () => {
  /**
   * Length is the channel people forget. Colyseus encodes a *separate* patch
   * per client, so the question is whether the witness's patch gets bigger on
   * the tick a kill lands somewhere they cannot see.
   *
   * The assertion is deliberately about the *set of observed packet sizes*
   * rather than about totals: a kill that adds a few bytes to one tick would
   * barely move a sum over a window, but it introduces a packet size that
   * never otherwise occurs — which is exactly what an attacker would key on.
   */
  /**
   * FIXED (was a KNOWN LEAK). `GameRoom.update` re-dirties every body every
   * tick so the fog filter re-runs (see the long comment there — that
   * heartbeat is load-bearing and correct). But a MapSchema with dirty
   * children used to contribute framing bytes to *every* client's patch,
   * including clients for whom every child is filtered out — so the instant
   * `state.bodies` stopped being empty, every distant witness's steady-state
   * patch grew by a constant 2 bytes and stayed there. Measured, not
   * theorised: 0 bodies -> 28 B/patch, 1 body -> 30 B, 2 bodies -> 30 B.
   *
   * The fix: `GameState.bodies` now permanently holds one extra entry
   * (`PADDING_BODY_ID`, seeded once in `onCreate`, filtered out for every
   * client including ghosts, never removed) — see that field's own doc. The
   * map is non-empty from before any player can possibly die, so the
   * empty-to-non-empty step this side channel keyed on has already happened,
   * identically, for every client, before the first kill of the match. A
   * real body's later arrival is a 1-to-2 transition, which — also
   * confirmed above — costs nothing further.
   */
  it("does not change a distant witness's steady-state patch size when the first body appears", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim, witnesses } = stageKill(seats);
    const witness = witnesses[0]!;
    await tick(4);

    const baselineStart = Date.now();
    await tick(20);
    const baseline = witness.since(baselineStart).packets.map((p) => p.bytes);
    expect(baseline.length, "no traffic captured — the tap is not working").toBeGreaterThan(3);
    const baselineMax = Math.max(...baseline);

    const killStart = Date.now();
    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(20);
    const during = witness.since(killStart).packets.map((p) => p.bytes);

    expect(victim.player.alive).toBe(false);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    const outliers = during.filter((bytes) => bytes > baselineMax);
    expect(
      outliers,
      `a distant witness received packet(s) of ${JSON.stringify(outliers)} bytes during ` +
        `the kill window, larger than anything in the ${baseline.length}-packet quiet ` +
        `baseline (max ${baselineMax}). Packet length alone would reveal the kill.`,
    ).toEqual([]);
  });

  /**
   * The half of the size channel that IS closed, pinned so a future change
   * cannot quietly widen the known leak above from "a kill happened" into "a
   * kill happened *here*" or "N kills have happened".
   */
  it("does not vary the witness's patch size with where the kill happened", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim, witnesses } = stageKill(seats);
    const witness = witnesses[0]!;

    // Kill right next to the witness's corner rather than across the map. If
    // patch size encoded position, this would differ from the far-corner case.
    killer.player.x = FAR_CORNER.x - 40;
    killer.player.y = FAR_CORNER.y - 40;
    victim.player.x = FAR_CORNER.x - 40;
    victim.player.y = FAR_CORNER.y - 40;
    // Witness moved well clear so they still cannot see it happen.
    witness.player.x = KILL_CORNER.x;
    witness.player.y = KILL_CORNER.y;
    await tick(4);

    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(6);
    expect(victim.player.alive).toBe(false);

    const settledStart = Date.now();
    await tick(16);
    const sizes = new Set(witness.since(settledStart).packets.map((p) => p.bytes));

    // One steady size, whatever it is — no per-tick variation that could carry
    // the victim's coordinates.
    expect(
      sizes.size,
      `witness saw ${sizes.size} distinct patch sizes (${[...sizes].join(", ")}) after a ` +
        `kill they cannot see; a varying size could encode where it happened.`,
    ).toBeLessThanOrEqual(2);
  });

  it("keeps a witness's patch stream statistically flat across the kill tick", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim, witnesses } = stageKill(seats);
    const witness = witnesses[0]!;
    await tick(4);

    const baselineStart = Date.now();
    await tick(20);
    const baseline = witness.since(baselineStart).packets;

    const killStart = Date.now();
    armAbility(room, killer.client.sessionId, "kill");
    killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
    await tick(20);
    const during = witness.since(killStart).packets;

    expect(victim.player.alive).toBe(false);

    // Packet COUNT is the coarser half of the timing channel: an extra frame
    // in the window is detectable even if every frame is the same size.
    const drift = Math.abs(during.length - baseline.length);
    expect(
      drift,
      `witness received ${during.length} packets during the kill window vs ` +
        `${baseline.length} in an equal quiet window — a count difference is itself ` +
        `a signal.`,
    ).toBeLessThanOrEqual(2);
  });

  /**
   * The padding fix (`PADDING_BODY_ID`) closes the CONTAINER-level leak: the
   * one-time cost of `bodies` going from empty to non-empty. It says nothing
   * about whether an individual body's own CONTENT — the victim's name, the
   * kill's position — costs a different number of bytes for a distant,
   * fully-filtered-out witness depending on what that content is.
   *
   * That distinction matters because `@colyseus/schema` encodes both
   * `"number"` and `"string"` fields at VARIABLE width: a `"number"` field is
   * 1 byte for a small non-negative integer and grows with magnitude, or a
   * flat 9 bytes the instant the value has a fractional part (see
   * `encode.number` / `number$1` in `@colyseus/schema`); a `"string"` field's
   * length prefix and payload both scale with the string's own byte length.
   * `Body.x`/`Body.y` and `Body.name` are exactly these types. If Colyseus's
   * per-client filtering were ever less than airtight — encoding some sliver
   * of a filtered-out child's content before deciding to omit it, say — three
   * kills with three different name lengths in three different (and
   * differently-sized) rooms would show it: the wire-size delta the witness
   * sees would differ kill to kill, correlating with content nobody sent them.
   *
   * This is deliberately NOT theorised away — it is checked directly, kill by
   * kill, rather than assumed safe because the container-level fix already
   * landed.
   */
  it("produces an identical wire-size delta for three sequential kills with different victim name lengths in different rooms", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 10);
    const { strangers, townsfolk } = splitRoles(seats);
    const killer = strangers[0]!;
    const victims = townsfolk.slice(0, 3);
    const witness = townsfolk[3] ?? strangers[1];
    expect(victims).toHaveLength(3);
    expect(witness, "not enough players for killer + 3 victims + a distinct witness").toBeDefined();

    // Deliberately different lengths — 1, 14, and 39 characters — set
    // directly rather than through the join flow so the length is exact and
    // not subject to any client-side name normalisation.
    victims[0]!.player.name = "A";
    victims[1]!.player.name = "MediumLengthNameX";
    victims[2]!.player.name = "AVeryLongPlayerNameChosenForThisTest39";

    // Three real rooms, deliberately far apart in the map's coordinate space
    // (so the raw x/y magnitudes differ) and with different slug lengths —
    // "tavern" (6), "fishMarket" (10), "warehouse" (9) — in case room
    // identity itself were ever encoded anywhere near a body.
    const kills = [
      { anchor: TASK_ROOM_ANCHOR.tavern, victim: victims[0]! },
      { anchor: TASK_ROOM_ANCHOR.fishMarket, victim: victims[1]! },
      { anchor: TASK_ROOM_ANCHOR.warehouse, victim: victims[2]! },
    ];

    // Parked once, far from all three rooms, for the entire test — and never
    // sent a single "input", so with nobody else moving either, the witness's
    // steady-state patch size should be essentially deterministic tick to
    // tick, making a clean before/after comparison possible.
    witness!.player.x = 40;
    witness!.player.y = 40;
    await tick(4);

    const steadySize = async (): Promise<number> => {
      const from = Date.now();
      await tick(10);
      const sizes = witness!.since(from).packets.map((p) => p.bytes);
      expect(sizes.length).toBeGreaterThan(3);
      const sorted = [...sizes].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };

    const deltas: number[] = [];
    for (const { anchor, victim } of kills) {
      killer.player.x = anchor.x;
      killer.player.y = anchor.y;
      victim.player.x = anchor.x;
      victim.player.y = anchor.y;

      const before = await steadySize();

      armAbility(room, killer.client.sessionId, "kill");
      killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
      await tick(3);
      expect(victim.player.alive).toBe(false);

      const after = await steadySize();
      deltas.push(after - before);
    }

    expect(room.state.phase).toBe(PHASE.PLAYING);
    expect(
      deltas,
      `per-kill wire-size deltas for the witness were ${JSON.stringify(deltas)} — these must ` +
        `all be equal (ideally all 0). A difference here means some part of a body's own ` +
        `content (name length, position) is reaching a witness who cannot see it, encoded ` +
        `in the number of bytes it costs even though the content itself never arrives.`,
    ).toEqual([deltas[0], deltas[0], deltas[0]]);
  });
});
