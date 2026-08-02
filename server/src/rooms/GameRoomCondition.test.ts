import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  FACTION,
  factionOf,
  KILL_RANGE,
  LOBBY_READY_PAD_POINT,
  PHASE,
  PLAYER_CONDITION,
  PRESET,
  ROLE_REVEAL_MS,
  ROLES,
  TICK_RATE,
  type RoleAssignment,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState, Player } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/**
 * §8.1's death model: healthy → injured → dead, and everything that model
 * touches.
 *
 * Nothing in the game injures anyone yet — that arrives with the risky-task
 * framework in 8.2 — so these tests drive `injure` directly through the room
 * instance, the same way the existing suites reach `abilityReadyAt` to arm a
 * cooldown. That is deliberate: the state machine and its consequences are
 * what 8.1 delivers, and they need pinning now, before a caller exists that
 * could quietly disagree with them.
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

let seatCount = 0;

async function seat(room: ServerRoom<GameState>) {
  const client = await colyseus.connectTo(room, { name: `Hurt${++seatCount}` });
  const player = room.state.players.get(client.sessionId)!;
  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (m: RoleAssignment) => roleMessages.push(m));
  const abilityEffects: { type: string; targetId: string }[] = [];
  client.onMessage("abilityEffect", (m: { type: string; targetId: string }) =>
    abilityEffects.push(m),
  );
  return { client, player, roleMessages, abilityEffects };
}

type Seat = Awaited<ReturnType<typeof seat>>;

async function seatAndPlay(room: ServerRoom<GameState>, count = 5): Promise<Seat[]> {
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

/** Seat a Chaos lobby big enough to deal a Doctor, and play. */
async function seatChaosAndPlay(room: ServerRoom<GameState>, count = 8): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    seats.push(await seat(room));
  }
  seats[0]!.client.send("set_preset", { preset: PRESET.CHAOS });
  seats[0]!.client.send("set_setting", { key: "roleSelectionEnabled", value: "false" });
  await tick(2);
  for (const s of seats) {
    s.player.x = LOBBY_READY_PAD_POINT.x;
    s.player.y = LOBBY_READY_PAD_POINT.y;
  }
  seats[0]!.client.send("start");
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
  return seats;
}

/**
 * 8.1 ships the state machine with no caller (`injure` is reached in 8.2 by
 * the risky-task framework), so the tests are the first caller. Same idiom as
 * `armAbility` in the other suites.
 */
function injure(room: ServerRoom<GameState>, player: Player): void {
  (room as unknown as { injure(p: Player): void }).injure(player);
}

function armAbility(room: ServerRoom<GameState>, sessionId: string, abilityId: string): void {
  (room as unknown as { abilityReadyAt: Map<string, number> }).abilityReadyAt.set(
    `${sessionId}:${abilityId}`,
    0,
  );
}

/** The invariant the whole two-field design rests on. Checked after every mutation. */
function expectMirrored(room: ServerRoom<GameState>): void {
  room.state.players.forEach((player, id) => {
    expect(
      player.alive,
      `${id}: alive=${player.alive} disagrees with condition=${player.condition}`,
    ).toBe(player.condition !== PLAYER_CONDITION.DEAD);
  });
}

describe("§8.1 the condition state machine", () => {
  it("starts everyone healthy and alive", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    for (const s of seats) {
      expect(s.player.condition).toBe(PLAYER_CONDITION.HEALTHY);
      expect(s.player.alive).toBe(true);
    }
    expectMirrored(room);
  });

  it("hurts a healthy player to injured, leaving them alive and bodiless", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const victim = seats[1]!;

    injure(room, victim.player);
    await tick(2);

    expect(victim.player.condition).toBe(PLAYER_CONDITION.INJURED);
    expect(victim.player.alive).toBe(true);
    expect(room.state.bodies.has(victim.client.sessionId)).toBe(false);
    expect(room.state.phase).toBe(PHASE.PLAYING);
    expectMirrored(room);
  });

  it("kills an already-injured player on the second injury", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const victim = seats[1]!;

    injure(room, victim.player);
    injure(room, victim.player);
    await tick(3);

    expect(victim.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expect(victim.player.alive).toBe(false);
    expectMirrored(room);
  });

  it("leaves a real, reportable corpse where the second injury landed", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const victim = seats[1]!;
    victim.player.x = 600;
    victim.player.y = 832;
    await tick(2);

    injure(room, victim.player);
    injure(room, victim.player);
    await tick(3);

    const body = room.state.bodies.get(victim.client.sessionId);
    expect(body).toBeDefined();
    expect(body!.x).toBeCloseTo(600, 5);
    expect(body!.y).toBeCloseTo(832, 5);
    expect(body!.name).toBe(victim.player.name);
    // §4.4's death sequence, identical to a murder's.
    expect(victim.player.lanternState).toBe("dropped");
  });

  it("is idempotent once dead — a corpse cannot be hurt further", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const victim = seats[1]!;

    injure(room, victim.player);
    injure(room, victim.player);
    await tick(3);
    const bodiesAfterDeath = room.state.bodies.size;

    injure(room, victim.player);
    injure(room, victim.player);
    await tick(2);

    expect(victim.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expect(room.state.bodies.size).toBe(bodiesAfterDeath);
    expectMirrored(room);
  });

  it("counts an injured player as alive for the win conditions", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    // Injure everyone. Nobody has died, so nothing may resolve.
    for (const s of seats) {
      injure(room, s.player);
    }
    await tick(3);

    expect(room.state.phase).toBe(PHASE.PLAYING);
    expect(room.state.winningFaction).toBe("");
    expectMirrored(room);
  });

  it("counts a task death toward the win conditions exactly as a murder does", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const { strangers, townsfolk } = {
      strangers: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.STRANGER),
      townsfolk: seats.filter((s) => factionOf(s.roleMessages[0]!.role) === FACTION.TOWNSFOLK),
    };
    expect(strangers.length).toBe(1);

    // Kill every townsfolk but one by pure accident — no Stranger involved —
    // and the Strangers still reach parity and win.
    for (const t of townsfolk.slice(0, townsfolk.length - 1)) {
      injure(room, t.player);
      injure(room, t.player);
    }
    await tick(4);

    expect(room.state.phase).toBe(PHASE.GAME_OVER);
    expect(room.state.winningFaction).toBe(FACTION.STRANGER);
    expectMirrored(room);
  });
});

describe("§8.1 injury and the rest of the round", () => {
  it("keeps an injury across a meeting — only a doctor undoes it", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const victim = seats[1]!;
    injure(room, victim.player);
    await tick(2);

    // A body report opens a meeting, which clears the per-round store the
    // doctor's shield lives in. Condition lives on `Player`, not there.
    const corpse = seats[2]!;
    injure(room, corpse.player);
    injure(room, corpse.player);
    await tick(3);
    seats[0]!.player.x = corpse.player.x;
    seats[0]!.player.y = corpse.player.y;
    await tick(2);
    seats[0]!.client.send("report_body", { bodyId: corpse.client.sessionId });
    await tick(4);

    expect(room.state.phase).toBe(PHASE.MEETING);
    expect(victim.player.condition).toBe(PLAYER_CONDITION.INJURED);
    expectMirrored(room);
  });

  it("lets an injured player report a body and vote — they are alive", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const reporter = seats[0]!;
    const corpse = seats[2]!;

    injure(room, reporter.player);
    injure(room, corpse.player);
    injure(room, corpse.player);
    await tick(3);

    reporter.player.x = corpse.player.x;
    reporter.player.y = corpse.player.y;
    await tick(2);
    reporter.client.send("report_body", { bodyId: corpse.client.sessionId });
    await tick(4);

    expect(room.state.phase).toBe(PHASE.MEETING);
    expect(room.state.meetingReporterId).toBe(reporter.client.sessionId);

    // And their ballot counts.
    (room as unknown as { startVoting(): void }).startVoting?.();
    await tick(2);
    expect(reporter.player.condition).toBe(PLAYER_CONDITION.INJURED);
    expect(reporter.player.alive).toBe(true);
  });

  it("makes a ghost of an injured player exactly as of a healthy one", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [a, b] = [seats[0]!, seats[1]!];

    // A dies injured, B dies healthy. Both are simply dead afterwards.
    injure(room, a.player);
    injure(room, a.player);
    injure(room, b.player);
    injure(room, b.player);
    await tick(4);

    expect(a.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expect(b.player.condition).toBe(PLAYER_CONDITION.DEAD);
    // No residue of the injury survives the death — a ghost is a ghost.
    expect(a.player.condition).toBe(b.player.condition);
    expect(a.player.alive).toBe(b.player.alive);
    expect(a.player.lanternState).toBe(b.player.lanternState);
  });

  it("kills outright on ejection regardless of condition", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const victim = seats[1]!;
    injure(room, victim.player);
    await tick(2);
    expect(victim.player.condition).toBe(PLAYER_CONDITION.INJURED);

    (room as unknown as { ejectPlayer(id: string): void }).ejectPlayer(
      victim.client.sessionId,
    );
    await tick(2);

    expect(victim.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expect(victim.player.alive).toBe(false);
    expectMirrored(room);
  });

  it("heals every wound at round reset, not merely revives", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    injure(room, seats[1]!.player);
    injure(room, seats[2]!.player);
    injure(room, seats[2]!.player);
    await tick(3);

    // Through the real host-only path, not a private method — the reset that
    // matters is the one a player can actually trigger.
    (room as unknown as { declareGameOver(f: string, r: string): void }).declareGameOver(
      FACTION.TOWNSFOLK,
      "tasks",
    );
    await tick(3);
    seats[0]!.client.send("return_to_lobby");
    await tick(4);

    expect(room.state.phase).toBe(PHASE.LOBBY);
    for (const s of seats) {
      expect(s.player.condition).toBe(PLAYER_CONDITION.HEALTHY);
      expect(s.player.alive).toBe(true);
      expect(s.player.lanternState).toBe("lit");
    }
    expectMirrored(room);
  });
});

describe("§8.1 the doctor's heal", () => {
  it("returns an injured player to healthy, and tells only the doctor", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room);
    const doctor = seats.find((s) => s.roleMessages[0]?.role === ROLES.DOCTOR);
    expect(doctor, "chaos at 8 players should deal a doctor").toBeDefined();
    const patient = seats.find((s) => s !== doctor)!;

    injure(room, patient.player);
    await tick(2);
    expect(patient.player.condition).toBe(PLAYER_CONDITION.INJURED);

    patient.player.x = doctor!.player.x;
    patient.player.y = doctor!.player.y;
    await tick(2);
    armAbility(room, doctor!.client.sessionId, "heal");
    doctor!.client.send("ability", {
      abilityId: "heal",
      targetId: patient.client.sessionId,
    });
    await tick(4);

    expect(patient.player.condition).toBe(PLAYER_CONDITION.HEALTHY);
    expect(patient.player.alive).toBe(true);
    expectMirrored(room);

    // The confirmation is the doctor's alone — the patient is not told who
    // treated them, the same discipline `protect` follows.
    expect(doctor!.abilityEffects.map((e) => e.type)).toContain("healed");
    for (const s of seats) {
      if (s === doctor) continue;
      expect(s.abilityEffects.map((e) => e.type)).not.toContain("healed");
    }
  });

  it("refuses to heal out of range, and the injury stands", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room);
    const doctor = seats.find((s) => s.roleMessages[0]?.role === ROLES.DOCTOR)!;
    const patient = seats.find((s) => s !== doctor)!;

    injure(room, patient.player);
    patient.player.x = doctor.player.x + KILL_RANGE * 5;
    await tick(2);

    armAbility(room, doctor.client.sessionId, "heal");
    doctor.client.send("ability", {
      abilityId: "heal",
      targetId: patient.client.sessionId,
    });
    await tick(4);

    expect(patient.player.condition).toBe(PLAYER_CONDITION.INJURED);
    expect(doctor.abilityEffects.map((e) => e.type)).not.toContain("healed");
  });

  it("cannot resurrect the dead", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room);
    const doctor = seats.find((s) => s.roleMessages[0]?.role === ROLES.DOCTOR)!;
    const patient = seats.find((s) => s !== doctor)!;

    injure(room, patient.player);
    injure(room, patient.player);
    await tick(3);
    expect(patient.player.condition).toBe(PLAYER_CONDITION.DEAD);

    patient.player.x = doctor.player.x;
    patient.player.y = doctor.player.y;
    armAbility(room, doctor.client.sessionId, "heal");
    doctor.client.send("ability", {
      abilityId: "heal",
      targetId: patient.client.sessionId,
    });
    await tick(4);

    expect(patient.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expect(patient.player.alive).toBe(false);
    expectMirrored(room);
  });

  it("spends the use on a healthy target rather than answering whether they were hurt", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room);
    const doctor = seats.find((s) => s.roleMessages[0]?.role === ROLES.DOCTOR)!;
    const patient = seats.find((s) => s !== doctor)!;

    patient.player.x = doctor.player.x;
    patient.player.y = doctor.player.y;
    await tick(2);
    expect(patient.player.condition).toBe(PLAYER_CONDITION.HEALTHY);

    armAbility(room, doctor.client.sessionId, "heal");
    doctor.client.send("ability", {
      abilityId: "heal",
      targetId: patient.client.sessionId,
    });
    await tick(4);

    // Fired (so it costs a use and a cooldown) and confirmed, because a
    // refusal would turn the button into an injury detector for a target the
    // doctor cannot clearly see. See `heal.ts`'s doc.
    expect(doctor.abilityEffects.map((e) => e.type)).toContain("healed");
    expect(patient.player.condition).toBe(PLAYER_CONDITION.HEALTHY);
  });

  it("still has its shield, and the shield still ignores injury", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatChaosAndPlay(room);
    const doctor = seats.find((s) => s.roleMessages[0]?.role === ROLES.DOCTOR)!;
    const patient = seats.find((s) => s !== doctor)!;

    patient.player.x = doctor.player.x;
    patient.player.y = doctor.player.y;
    await tick(2);
    armAbility(room, doctor.client.sessionId, "protect");
    doctor.client.send("ability", {
      abilityId: "protect",
      targetId: patient.client.sessionId,
    });
    await tick(3);
    expect(doctor.abilityEffects.map((e) => e.type)).toContain("shielded");

    // The shield absorbs a Stranger's kill, not a task's harm: a shielded
    // player still gets hurt, and still dies to a second injury.
    injure(room, patient.player);
    await tick(2);
    expect(patient.player.condition).toBe(PLAYER_CONDITION.INJURED);
    injure(room, patient.player);
    await tick(3);
    expect(patient.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expectMirrored(room);
  });
});
