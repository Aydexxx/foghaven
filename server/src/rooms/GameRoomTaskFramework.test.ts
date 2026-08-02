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
  TASK_BAND_BOUNDS,
  TASK_DEFINITIONS,
  TASK_DEFINITIONS_BY_ID,
  TASK_INTERACT_RADIUS,
  TASK_TIER_BUDGET,
  TICK_RATE,
  type RiskTier,
  type RoleAssignment,
  type TaskOutcomeMessage,
  type TaskProgressMessage,
  type TaskRejectedMessage,
  type TaskStartedMessage,
  type TasksMessage,
} from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";

/**
 * §8.2's risky-task framework, tested from the position the prompt demands:
 * **the client is hostile.**
 *
 * The four behaviours it will attempt, and where each is answered:
 *
 *   1. Complete instantly or remotely  -> "plausibility" describe
 *   2. Report success when it failed   -> "the honest boundary" describe
 *   3. Report failure when it succeeded -> "self-harm is not a free alibi"
 *   4. Decline to report at all        -> "silence" describe (the important one)
 *
 * Nothing here drives the client UI. Every test speaks the wire directly,
 * because the UI is not the thing being trusted — a real attacker deletes it.
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

const tick = (count: number) =>
  new Promise((resolve) => setTimeout(resolve, (1000 / TICK_RATE) * count + 20));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let seatCount = 0;

async function seat(room: ServerRoom<GameState>) {
  const client = await colyseus.connectTo(room, { name: `Worker${++seatCount}` });
  const player = room.state.players.get(client.sessionId)!;
  const roleMessages: RoleAssignment[] = [];
  client.onMessage("role", (m: RoleAssignment) => roleMessages.push(m));
  const taskMessages: TasksMessage[] = [];
  client.onMessage("tasks", (m: TasksMessage) => taskMessages.push(m));
  const progress: TaskProgressMessage[] = [];
  client.onMessage("taskProgress", (m: TaskProgressMessage) => progress.push(m));
  const started: TaskStartedMessage[] = [];
  client.onMessage("taskStarted", (m: TaskStartedMessage) => started.push(m));
  const rejected: TaskRejectedMessage[] = [];
  client.onMessage("taskRejected", (m: TaskRejectedMessage) => rejected.push(m));
  const outcomes: TaskOutcomeMessage[] = [];
  client.onMessage("taskOutcome", (m: TaskOutcomeMessage) => outcomes.push(m));
  return { client, player, roleMessages, taskMessages, progress, started, rejected, outcomes };
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
  await wait(ROLE_REVEAL_MS + 200);
  return seats;
}

/**
 * Give this seat the named task and stand them at its station.
 *
 * Assignment is random, so tests that need a SPECIFIC tier write the entry
 * into the server's own task map rather than re-rolling until they get lucky.
 * This is the same "reach into the room" idiom `armAbility` uses elsewhere.
 */
function assignTaskAt(room: ServerRoom<GameState>, s: Seat, taskId: string): void {
  const def = TASK_DEFINITIONS_BY_ID.get(taskId)!;
  const tasks = (
    room as unknown as {
      tasks: Map<string, Map<string, { totalSteps: number; completedSteps: number }>>;
    }
  ).tasks;
  let mine = tasks.get(s.client.sessionId);
  if (!mine) {
    mine = new Map();
    tasks.set(s.client.sessionId, mine);
  }
  mine.set(taskId, { totalSteps: def.steps.length, completedSteps: 0 });
  s.player.x = def.x;
  s.player.y = def.y;
}

const SAFE_TASK = TASK_DEFINITIONS.find((t) => t.tier === "safe")!;
const INJURY_TASK = TASK_DEFINITIONS.find((t) => t.tier === "injury")!;
const LETHAL_TASK = TASK_DEFINITIONS.find((t) => t.tier === "lethal")!;

/** Long enough for the band's floor to have passed. */
const pastFloor = (taskId: string) =>
  wait(TASK_BAND_BOUNDS[TASK_DEFINITIONS_BY_ID.get(taskId)!.band].minMs + 250);

describe("§8.2 the module declaration", () => {
  it("declares every field for every task", () => {
    for (const def of TASK_DEFINITIONS) {
      expect(["short", "long"], def.id).toContain(def.band);
      expect(["safe", "injury", "lethal"], def.id).toContain(def.tier);
      expect(typeof def.witness, def.id).toBe("boolean");
      expect(typeof def.dark, def.id).toBe("boolean");
    }
  });

  it("keeps the balance rule: most safe, a handful injury, one or two lethal", () => {
    const counts: Record<RiskTier, number> = { safe: 0, injury: 0, lethal: 0 };
    for (const def of TASK_DEFINITIONS) {
      counts[def.tier] += 1;
    }
    expect(counts.injury).toBeLessThanOrEqual(TASK_TIER_BUDGET.injury);
    expect(counts.lethal).toBeLessThanOrEqual(TASK_TIER_BUDGET.lethal);
    expect(counts.lethal).toBeGreaterThanOrEqual(1);
    // "Most tasks are safe" — a strict majority, not merely the plurality.
    expect(counts.safe).toBeGreaterThan(counts.injury + counts.lethal);
  });

  it("hands the declaration to the client so risk can be telegraphed before committing", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    for (const task of seats[0]!.taskMessages[0]!.tasks) {
      const def = TASK_DEFINITIONS_BY_ID.get(task.id)!;
      expect(task.tier).toBe(def.tier);
      expect(task.band).toBe(def.band);
      expect(task.witness).toBe(def.witness);
      expect(task.dark).toBe(def.dark);
    }
  });
});

describe("§8.2 plausibility — instant and remote completion", () => {
  it("refuses to open an attempt away from the station", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    s.player.x = SAFE_TASK.x + TASK_INTERACT_RADIUS * 6;
    await tick(2);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(3);

    expect(s.started).toHaveLength(0);
    expect(s.rejected.at(-1)?.reason).toBe("out_of_range");
    expect(s.progress).toHaveLength(0);
  });

  it("refuses a resolve that arrives faster than the work could possibly take", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(2);
    expect(s.started).toHaveLength(1);

    // Instantly claim it. This is the headline cheat.
    s.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true });
    await tick(3);

    expect(s.rejected.at(-1)?.reason).toBe("too_fast");
    expect(s.progress).toHaveLength(0);
    expect(room.state.taskBarCompleted).toBe(0);
  });

  it("does not let a premature claim shake off the attempt it is committed to", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(2);
    s.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true }); // rejected
    await tick(2);

    // The attempt is still open — a rejected claim must not be a way out.
    const attempts = (room as unknown as { taskAttempts: Map<string, unknown> }).taskAttempts;
    expect(attempts.has(s.client.sessionId)).toBe(true);

    // And once the floor has genuinely passed, the same claim is honoured.
    await pastFloor(SAFE_TASK.id);
    s.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true });
    await tick(3);
    expect(s.progress).toHaveLength(1);
  });

  it("voids the work of a client that walks away mid-attempt and then claims it", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(2);
    // Off across the map while the puzzle "runs".
    s.player.x = SAFE_TASK.x + TASK_INTERACT_RADIUS * 8;
    await pastFloor(SAFE_TASK.id);
    s.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true });
    await tick(3);

    expect(s.progress).toHaveLength(0);
    expect(room.state.taskBarCompleted).toBe(0);
    expect(s.outcomes.at(-1)?.success).toBe(false);
  });

  it("refuses a second attempt while one is already open", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(2);
    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(3);

    expect(s.started).toHaveLength(1);
    expect(s.rejected.at(-1)?.reason).toBe("busy");
  });

  it("caps the completion rate at one per band floor, however fast the client spams", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats.find((x) => factionOf(x.roleMessages[0]!.role) === FACTION.TOWNSFOLK)!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    const began = Date.now();
    // Hammer the whole lifecycle as fast as the socket allows for 3 seconds.
    const deadline = began + 3_000;
    while (Date.now() < deadline) {
      s.client.send("task_start", { taskId: SAFE_TASK.id });
      s.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true });
      await tick(1);
    }
    await tick(3);

    const elapsed = Date.now() - began;
    const ceiling = Math.ceil(elapsed / TASK_BAND_BOUNDS[SAFE_TASK.band].minMs);
    expect(s.progress.length).toBeLessThanOrEqual(ceiling);
  });

  it("refuses a task that is not on this player's own list", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    const assigned = new Set(s.taskMessages[0]!.tasks.map((t) => t.id));
    const foreign = TASK_DEFINITIONS.find((t) => !assigned.has(t.id))!;
    s.player.x = foreign.x;
    s.player.y = foreign.y;
    await tick(2);

    s.client.send("task_start", { taskId: foreign.id, confirmed: true });
    await tick(3);

    expect(s.started).toHaveLength(0);
    expect(s.rejected.at(-1)?.reason).toBe("not_assigned");
  });

  it("refuses to resolve an attempt that was never opened", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    s.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true });
    await tick(3);

    expect(s.rejected.at(-1)?.reason).toBe("not_started");
    expect(s.progress).toHaveLength(0);
  });

  it("refuses a step on an already-finished task", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await pastFloor(SAFE_TASK.id);
    s.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true });
    await tick(3);
    expect(s.progress).toHaveLength(1);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(3);
    expect(s.rejected.at(-1)?.reason).toBe("already_complete");
  });
});

describe("§8.2 silence — the client that declines to report", () => {
  /**
   * The case the prompt calls out as the important one, and the reason an
   * attempt is a server-owned object rather than a client-side flow.
   */
  it("resolves a safe attempt itself at the deadline, costing nothing", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, SAFE_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(2);
    // ...and then never speaks again.
    await wait(TASK_BAND_BOUNDS[SAFE_TASK.band].maxMs + 600);

    const outcome = s.outcomes.at(-1);
    expect(outcome?.timedOut).toBe(true);
    expect(outcome?.success).toBe(false);
    expect(s.player.condition).toBe(PLAYER_CONDITION.HEALTHY);
    expect(s.progress).toHaveLength(0);
    const attempts = (room as unknown as { taskAttempts: Map<string, unknown> }).taskAttempts;
    expect(attempts.has(s.client.sessionId)).toBe(false);
  }, 30_000);

  it("injures a silent client on an injury task — going quiet is not an escape", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, INJURY_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: INJURY_TASK.id });
    await tick(2);
    await wait(TASK_BAND_BOUNDS[INJURY_TASK.band].maxMs + 600);

    expect(s.outcomes.at(-1)?.timedOut).toBe(true);
    expect(s.player.condition).toBe(PLAYER_CONDITION.INJURED);
    expect(s.player.alive).toBe(true);
  }, 30_000);

  it("kills a silent client on the lethal task, and leaves an ordinary corpse", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, LETHAL_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: LETHAL_TASK.id, confirmed: true });
    await tick(2);
    await wait(TASK_BAND_BOUNDS[LETHAL_TASK.band].maxMs + 800);

    expect(s.player.condition).toBe(PLAYER_CONDITION.DEAD);
    expect(s.player.alive).toBe(false);
    // A corpse indistinguishable from a murder's — no cause recorded anywhere.
    const body = room.state.bodies.get(s.client.sessionId);
    expect(body).toBeDefined();
    const deathLocations = (
      room as unknown as { deathLocations: Map<string, unknown> }
    ).deathLocations;
    expect(deathLocations.has(s.client.sessionId)).toBe(false);
  }, 45_000);

  it("does not let a risky attempt be aborted, but does let a safe one go", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const [risky, safe] = [seats[0]!, seats[1]!];
    assignTaskAt(room, risky, INJURY_TASK.id);
    assignTaskAt(room, safe, SAFE_TASK.id);
    await tick(2);

    risky.client.send("task_start", { taskId: INJURY_TASK.id });
    safe.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(2);

    risky.client.send("task_abort", { taskId: INJURY_TASK.id });
    safe.client.send("task_abort", { taskId: SAFE_TASK.id });
    await tick(3);

    const attempts = (room as unknown as { taskAttempts: Map<string, unknown> }).taskAttempts;
    // The safe one is gone with no consequence; the risky one is still owed.
    expect(attempts.has(safe.client.sessionId)).toBe(false);
    expect(attempts.has(risky.client.sessionId)).toBe(true);
    expect(risky.player.condition).toBe(PLAYER_CONDITION.HEALTHY);

    // And that outstanding attempt still lands.
    await wait(TASK_BAND_BOUNDS[INJURY_TASK.band].maxMs + 600);
    expect(risky.player.condition).toBe(PLAYER_CONDITION.INJURED);
  }, 30_000);
});

describe("§8.2 self-harm is not a free alibi", () => {
  /**
   * A client reporting failure it did not suffer is trying to manufacture an
   * injury as social cover. The answer is not detection — it is that the
   * server never fakes: a reported failure IS one, at full price.
   */
  it("charges the real price for a reported failure", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, INJURY_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: INJURY_TASK.id });
    await pastFloor(INJURY_TASK.id);
    s.client.send("task_resolve", { taskId: INJURY_TASK.id, success: false });
    await tick(3);

    expect(s.player.condition).toBe(PLAYER_CONDITION.INJURED);
    // And it bought no progress toward anything.
    expect(s.progress).toHaveLength(0);
    expect(room.state.taskBarCompleted).toBe(0);
  });

  it("kills on a second self-reported failure, exactly as 8.1's model says", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, INJURY_TASK.id);
    await tick(2);

    for (let i = 0; i < 2; i++) {
      s.client.send("task_start", { taskId: INJURY_TASK.id });
      await pastFloor(INJURY_TASK.id);
      s.client.send("task_resolve", { taskId: INJURY_TASK.id, success: false });
      await tick(3);
    }

    expect(s.player.condition).toBe(PLAYER_CONDITION.DEAD);
  }, 20_000);

  /**
   * The sharpest version of the alibi cheat: a STRANGER faking task harm.
   * Their task list is fake, so if fake tasks were harmless, surviving the
   * crane would identify them instantly. Risk is a property of the station.
   */
  it("applies identical risk to a Stranger's fake task", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const stranger = seats.find(
      (x) => factionOf(x.roleMessages[0]!.role) === FACTION.STRANGER,
    )!;
    assignTaskAt(room, stranger, INJURY_TASK.id);
    await tick(2);

    stranger.client.send("task_start", { taskId: INJURY_TASK.id });
    await pastFloor(INJURY_TASK.id);
    stranger.client.send("task_resolve", { taskId: INJURY_TASK.id, success: false });
    await tick(3);

    expect(stranger.player.condition).toBe(PLAYER_CONDITION.INJURED);
  });

  it("still refuses to move the public bar for a Stranger's success", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const stranger = seats.find(
      (x) => factionOf(x.roleMessages[0]!.role) === FACTION.STRANGER,
    )!;
    assignTaskAt(room, stranger, SAFE_TASK.id);
    await tick(2);
    const before = room.state.taskBarCompleted;

    stranger.client.send("task_start", { taskId: SAFE_TASK.id });
    await pastFloor(SAFE_TASK.id);
    stranger.client.send("task_resolve", { taskId: SAFE_TASK.id, success: true });
    await tick(3);

    // Their own screen sees the identical progress a townsfolk would...
    expect(stranger.progress).toEqual([{ taskId: SAFE_TASK.id, completedSteps: 1 }]);
    // ...and the bar does not move.
    expect(room.state.taskBarCompleted).toBe(before);
  });
});

describe("§8.2 never a surprise death", () => {
  it("refuses to open a lethal attempt without an explicit confirmation", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, LETHAL_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: LETHAL_TASK.id });
    await tick(3);

    expect(s.started).toHaveLength(0);
    expect(s.rejected.at(-1)?.reason).toBe("unconfirmed");
    expect(s.player.alive).toBe(true);
    // Nothing was opened, so nothing can time out and kill them later either.
    const attempts = (room as unknown as { taskAttempts: Map<string, unknown> }).taskAttempts;
    expect(attempts.has(s.client.sessionId)).toBe(false);
  });

  it("opens it once confirmed, and kills on a reported failure", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, LETHAL_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: LETHAL_TASK.id, confirmed: true });
    await tick(2);
    expect(s.started).toHaveLength(1);
    expect(s.started[0]!.tier).toBe("lethal");

    await pastFloor(LETHAL_TASK.id);
    s.client.send("task_resolve", { taskId: LETHAL_TASK.id, success: false });
    await tick(4);

    expect(s.player.condition).toBe(PLAYER_CONDITION.DEAD);
  }, 20_000);

  it("does not kill on a successful lethal attempt — the risk is failing, not attending", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, LETHAL_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: LETHAL_TASK.id, confirmed: true });
    await pastFloor(LETHAL_TASK.id);
    s.client.send("task_resolve", { taskId: LETHAL_TASK.id, success: true });
    await tick(4);

    expect(s.player.alive).toBe(true);
    expect(s.player.condition).toBe(PLAYER_CONDITION.HEALTHY);
    expect(s.progress).toHaveLength(1);
  }, 20_000);
});

describe("§8.2 attempts do not outlive the world they belong to", () => {
  it("abandons an in-flight attempt when a meeting starts, without failing it", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, LETHAL_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: LETHAL_TASK.id, confirmed: true });
    await tick(2);

    // Someone rings the bell: the round of play stops.
    (room as unknown as { startMeeting(ctx: unknown): void }).startMeeting({
      reporterId: s.client.sessionId,
      isEmergency: true,
    });
    await tick(3);

    const attempts = (room as unknown as { taskAttempts: Map<string, unknown> }).taskAttempts;
    expect(attempts.has(s.client.sessionId)).toBe(false);
    // Being called away is not the crane falling on you.
    expect(s.player.alive).toBe(true);
    expect(s.player.condition).toBe(PLAYER_CONDITION.HEALTHY);

    // And nothing fires later either.
    await wait(TASK_BAND_BOUNDS[LETHAL_TASK.band].maxMs + 500);
    expect(s.player.alive).toBe(true);
  }, 45_000);

  it("drops a dying player's attempt so no deadline chases a corpse", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats = await seatAndPlay(room);
    const s = seats[0]!;
    assignTaskAt(room, s, LETHAL_TASK.id);
    await tick(2);

    s.client.send("task_start", { taskId: LETHAL_TASK.id, confirmed: true });
    await tick(2);

    // Murdered mid-task by someone who does not care about the crane.
    (room as unknown as { applyDeath(p: unknown, k: string | null): void }).applyDeath(
      s.player,
      seats[1]!.client.sessionId,
    );
    await tick(3);

    const attempts = (room as unknown as { taskAttempts: Map<string, unknown> }).taskAttempts;
    expect(attempts.has(s.client.sessionId)).toBe(false);
    expect(s.player.condition).toBe(PLAYER_CONDITION.DEAD);
  });

  it("refuses to open an attempt outside open play", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const seats: Seat[] = [];
    for (let i = 0; i < 5; i++) {
      seats.push(await seat(room));
    }
    const s = seats[0]!;
    // Still in the lobby — no round is running.
    s.client.send("task_start", { taskId: SAFE_TASK.id });
    await tick(3);

    expect(s.started).toHaveLength(0);
    expect(s.rejected.at(-1)?.reason).toBe("phase");
  });
});
