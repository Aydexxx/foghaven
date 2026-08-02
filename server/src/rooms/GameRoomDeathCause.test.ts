import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  FACTION,
  factionOf,
  LOBBY_READY_PAD_POINT,
  PHASE,
  PLAYER_CONDITION,
  ROLE_REVEAL_MS,
  TICK_RATE,
  type RoleAssignment,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState, Player } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/**
 * **"Was this murder, or did they just die?"** — Foghaven's identity mechanic
 * (docs/ROADMAP_PHASE8.md, "Why this phase exists"), as an enforceable claim.
 *
 * A corpse made by a failed task and a corpse made by a Stranger must be
 * indistinguishable. That is not a statement about which fields the results
 * screen renders; it is a statement about **every byte every socket receives**
 * and about **when** it receives them. So, exactly the discipline
 * `GameRoomKillSecrecy.test.ts` established for the kill itself, applied to
 * the cause of death:
 *
 *   1. **Content** — does any message or public field differ between an
 *      accident and a murder?
 *   2. **Size** — do the two produce different patch lengths? An opaque
 *      payload that is reliably N bytes longer for a murder is a murder
 *      detector regardless of what is inside it.
 *   3. **Timing** — does either produce a packet the other does not, or at a
 *      different moment?
 *
 * Plus the one channel that is neither corpse nor packet: the **Medium**,
 * whose hint names a killer's faction and would otherwise announce "this one
 * had no killer". See `applyDeath` for why accidents never enter that pool.
 *
 * The comparison is deliberately between two deaths in *equivalent* rooms
 * rather than before/after within one, because the thing being compared is
 * the shape of a death, not the shape of a tick.
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

interface WirePacket {
  at: number;
  bytes: number;
}

interface AppMessage {
  at: number;
  type: string;
}

let seatCount = 0;

async function seat(room: ServerRoom<GameState>) {
  const name = `Cause${++seatCount}`;
  const client = await colyseus.connectTo(room, { name });
  const player = room.state.players.get(client.sessionId)!;

  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (m: RoleAssignment) => roleMessages.push(m));

  const messages: AppMessage[] = [];
  client.onMessage("*", (type: string | number) => {
    messages.push({ at: Date.now(), type: String(type) });
  });

  const packets: WirePacket[] = [];
  const raw: string[] = [];
  const ws = (
    client as unknown as { connection: { transport: { ws: WebSocket } } }
  ).connection.transport.ws;
  ws.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as ArrayBuffer | Buffer | string;
    let bytes: number;
    if (typeof data === "string") {
      bytes = Buffer.byteLength(data);
      raw.push(data);
    } else if (data instanceof ArrayBuffer) {
      bytes = data.byteLength;
      raw.push(Buffer.from(data).toString("binary"));
    } else {
      bytes = (data as Buffer).length;
      raw.push((data as Buffer).toString("binary"));
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
    raw,
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
  for (const s of seats) {
    s.player.x = LOBBY_READY_PAD_POINT.x;
    s.player.y = LOBBY_READY_PAD_POINT.y;
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

function injure(room: ServerRoom<GameState>, player: Player): void {
  (room as unknown as { injure(p: Player): void }).injure(player);
}

const DEATH_CORNER = { x: 200, y: 200 };
const FAR_CORNER = { x: 1400, y: 1050 };

/**
 * Stage the two deaths identically: the doomed player and (for the murder
 * case) their killer together in one corner, every witness in the other.
 */
function stage(seats: Seat[]) {
  const { strangers, townsfolk } = splitRoles(seats);
  const killer = strangers[0]!;
  const victim = townsfolk[0]!;
  const witnesses = seats.filter((s) => s !== killer && s !== victim);

  killer.player.x = DEATH_CORNER.x;
  killer.player.y = DEATH_CORNER.y;
  victim.player.x = DEATH_CORNER.x;
  victim.player.y = DEATH_CORNER.y;
  for (const w of witnesses) {
    w.player.x = FAR_CORNER.x;
    w.player.y = FAR_CORNER.y;
  }
  return { killer, victim, witnesses };
}

/** Kill by task: two injuries, no killer anywhere near. */
async function killByAccident(room: ServerRoom<GameState>, victim: Seat) {
  injure(room, victim.player);
  injure(room, victim.player);
  await tick(6);
}

/** Kill by Stranger, through the real ability path. */
async function killByMurder(room: ServerRoom<GameState>, killer: Seat, victim: Seat) {
  armAbility(room, killer.client.sessionId, "kill");
  killer.client.send("ability", { abilityId: "kill", targetId: victim.client.sessionId });
  await tick(6);
}

describe("cause of death — the corpse itself", () => {
  it("leaves a body with no field that differs between accident and murder", async () => {
    const murderRoom = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const murderSeats = await seatAndPlay(murderRoom, 6);
    const murder = stage(murderSeats);
    await tick(2);
    await killByMurder(murderRoom, murder.killer, murder.victim);

    const accidentRoom = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const accidentSeats = await seatAndPlay(accidentRoom, 6);
    const accident = stage(accidentSeats);
    await tick(2);
    await killByAccident(accidentRoom, accident.victim);

    const murdered = murderRoom.state.bodies.get(murder.victim.client.sessionId)!;
    const accidental = accidentRoom.state.bodies.get(accident.victim.client.sessionId)!;
    expect(murdered).toBeDefined();
    expect(accidental).toBeDefined();

    // Same field set, and the same values for everything that isn't the
    // player's own identity. A `cause`/`killer` field appearing on `Body`
    // would fail here immediately.
    expect(new Set(Object.keys(accidental.toJSON()))).toEqual(
      new Set(Object.keys(murdered.toJSON())),
    );
    expect(accidental.x).toBe(murdered.x);
    expect(accidental.y).toBe(murdered.y);
  });

  it("leaves the victim in an identical public state either way", async () => {
    const murderRoom = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const murderSeats = await seatAndPlay(murderRoom, 6);
    const murder = stage(murderSeats);
    await tick(2);
    await killByMurder(murderRoom, murder.killer, murder.victim);

    const accidentRoom = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const accidentSeats = await seatAndPlay(accidentRoom, 6);
    const accident = stage(accidentSeats);
    await tick(2);
    await killByAccident(accidentRoom, accident.victim);

    for (const p of [murder.victim.player, accident.victim.player]) {
      expect(p.alive).toBe(false);
      expect(p.condition).toBe(PLAYER_CONDITION.DEAD);
      expect(p.lanternState).toBe("dropped");
    }
    // Critically: the injured intermediate state does NOT survive the death.
    // A corpse that still read `injured` would advertise that it got there
    // the slow way.
    expect(accident.victim.player.condition).toBe(murder.victim.player.condition);
  });

  it("is reportable and opens a meeting exactly as a murder is", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { victim, witnesses } = stage(seats);
    await tick(2);
    await killByAccident(room, victim);

    const reporter = witnesses[0]!;
    reporter.player.x = victim.player.x;
    reporter.player.y = victim.player.y;
    await tick(3);
    reporter.client.send("report_body", { bodyId: victim.client.sessionId });
    await tick(5);

    expect(room.state.phase).toBe(PHASE.MEETING);
    expect(room.state.meetingBodyId).toBe(victim.client.sessionId);
    expect(room.state.meetingBodyName).toBe(victim.player.name);
    expect([...room.state.deadPlayerIds]).toContain(victim.client.sessionId);
  });
});

describe("cause of death — content channel", () => {
  it("says nothing to a distant witness in either case", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { victim, witnesses } = stage(seats);
    await tick(3);

    const start = Date.now();
    await killByAccident(room, victim);

    expect(victim.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expect(room.state.phase).toBe(PHASE.PLAYING);

    for (const w of witnesses) {
      const types = w.since(start).messages.map((m) => m.type);
      expect(types).not.toContain("killed");
      expect(types).not.toContain("killConfirmed");
    }
  });

  it("never puts the victim's name or id on a distant witness's socket", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { victim, witnesses } = stage(seats);
    await tick(3);

    for (const w of witnesses) {
      w.raw.length = 0;
    }
    await killByAccident(room, victim);

    const haystack = witnesses.flatMap((w) => w.raw).join("");
    expect(haystack).not.toContain(victim.client.sessionId);
    expect(haystack).not.toContain(victim.name);
    // And the condition values themselves never travel to someone who cannot
    // see the player they describe.
    expect(haystack).not.toContain(PLAYER_CONDITION.INJURED);
  });

  it("sends no killConfirmed for an accident — there is no killer to confirm to", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim } = stage(seats);
    await tick(3);

    const start = Date.now();
    await killByAccident(room, victim);

    // The Stranger is standing right on top of the victim and still learns
    // nothing: they did not do this, so they are told nothing about it.
    expect(killer.since(start).messages.map((m) => m.type)).not.toContain("killConfirmed");
  });
});

describe("cause of death — timing and size channels", () => {
  /**
   * The headline test, and the direct analogue of the kill suite's own timing
   * test: two equivalent rooms, one death each, and a distant witness in
   * both. If either death produces a message type the other does not, that
   * type is a cause-of-death detector no matter what it contains.
   */
  it("produces the same set of message types for a witness either way", async () => {
    const murderRoom = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const murderSeats = await seatAndPlay(murderRoom, 6);
    const murder = stage(murderSeats);
    await tick(4);
    const murderStart = Date.now();
    await killByMurder(murderRoom, murder.killer, murder.victim);
    const murderTypes = new Set(
      murder.witnesses[0]!.since(murderStart).messages.map((m) => m.type),
    );

    const accidentRoom = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const accidentSeats = await seatAndPlay(accidentRoom, 6);
    const accident = stage(accidentSeats);
    await tick(4);
    const accidentStart = Date.now();
    await killByAccident(accidentRoom, accident.victim);
    const accidentTypes = new Set(
      accident.witnesses[0]!.since(accidentStart).messages.map((m) => m.type),
    );

    expect(murder.victim.player.alive).toBe(false);
    expect(accident.victim.player.alive).toBe(false);

    const onlyInAccident = [...accidentTypes].filter((t) => !murderTypes.has(t));
    const onlyInMurder = [...murderTypes].filter((t) => !accidentTypes.has(t));
    expect(
      { onlyInAccident, onlyInMurder },
      "a distant witness received a message type for one cause of death but not " +
        "the other — that type distinguishes accident from murder regardless of " +
        "its contents.",
    ).toEqual({ onlyInAccident: [], onlyInMurder: [] });
  });

  it("keeps a distant witness's patch stream statistically flat across either death", async () => {
    const measure = async (cause: "murder" | "accident") => {
      const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
      const seats = await seatAndPlay(room, 6);
      const staged = stage(seats);
      const witness = staged.witnesses[0]!;
      await tick(6);

      const controlStart = Date.now();
      await tick(6);
      const control = witness.since(controlStart).packets;

      const deathStart = Date.now();
      if (cause === "murder") {
        await killByMurder(room, staged.killer, staged.victim);
      } else {
        await killByAccident(room, staged.victim);
      }
      const during = witness.since(deathStart).packets;

      expect(staged.victim.player.alive).toBe(false);
      const mean = (xs: WirePacket[]) =>
        xs.length === 0 ? 0 : xs.reduce((sum, p) => sum + p.bytes, 0) / xs.length;
      return { control: mean(control), during: mean(during) };
    };

    const murder = await measure("murder");
    const accident = await measure("accident");

    // Neither death may perturb the witness's steady-state patch size, and
    // the two must not differ from each other either. A couple of bytes of
    // encoder noise is tolerated; a systematic step is not.
    expect(Math.abs(accident.during - accident.control)).toBeLessThanOrEqual(4);
    expect(Math.abs(murder.during - murder.control)).toBeLessThanOrEqual(4);
    expect(Math.abs(accident.during - murder.during)).toBeLessThanOrEqual(4);
  });
});

describe("cause of death — the medium channel", () => {
  /**
   * The one place cause of death could leak without a single extra byte
   * reaching anyone: the medium's hint names the killer's FACTION, and a
   * death with no killer would render as "unknown" — telling the medium, in
   * as many words, that this particular corpse was an accident.
   *
   * `applyDeath` therefore never records an accident in `deathLocations` at
   * all. The medium's pool contains murders only.
   */
  it("never offers an accident as a medium's fact", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { victim } = stage(seats);
    await tick(3);
    await killByAccident(room, victim);

    const deathLocations = (
      room as unknown as { deathLocations: Map<string, unknown> }
    ).deathLocations;
    expect(deathLocations.has(victim.client.sessionId)).toBe(false);
  });

  it("still records a murder, so the medium keeps working", async () => {
    const room = await colyseus.createRoom<GameState>("game", { autoDispose: false });
    const seats = await seatAndPlay(room, 6);
    const { killer, victim } = stage(seats);
    await tick(3);
    await killByMurder(room, killer, victim);

    const deathLocations = (
      room as unknown as {
        deathLocations: Map<string, { killerFaction: string | null }>;
      }
    ).deathLocations;
    const record = deathLocations.get(victim.client.sessionId);
    expect(record).toBeDefined();
    // A real faction, never null — a null here would render as "unknown" and
    // become exactly the accident tell this suite exists to prevent.
    expect(record!.killerFaction).toBe(FACTION.STRANGER);
  });
});
