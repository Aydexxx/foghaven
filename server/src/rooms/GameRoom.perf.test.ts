import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Server, type Room as ServerRoom } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ColyseusTestServer } from "@colyseus/testing";
import { MAP, ROLE_REVEAL_MS, TICK_RATE } from "@foghaven/shared";
import { GameRoom } from "./GameRoom";
import type { GameState } from "./schema/GameState";
import { InMemoryAuthProvider, setAuthProvider } from "../auth/provider";
import { InMemoryFriendProvider, setFriendProvider } from "../friends/provider";
import { tickDurationMs } from "../metrics";

/**
 * Measures GameRoom's real per-tick cost with a full 12-player room mid-round
 * — the "server tick with 12 players, target <10ms" pre-launch acceptance
 * check. A trimmed, self-contained bootstrap (not reusing GameRoom.test.ts's
 * `seat`/`seatAndPlay`, which also wire up a dozen message listeners no perf
 * test needs) so this file only pays for what it measures.
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

  // Port 0 for an OS-assigned ephemeral port — same reasoning as
  // GameRoom.test.ts's identical bootstrap: avoids a killed run's zombie
  // process permanently EADDRINUSE-ing a hardcoded port on the next run.
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

beforeEach(() => {
  tickDurationMs.reset();
});

function tick(count: number): Promise<void> {
  const ms = (1000 / TICK_RATE) * count + 20;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let seatCount = 0;

/** Bare-minimum seat: join at a known position, no message listeners — a perf test has nothing to assert on those. */
async function seat(room: ServerRoom<GameState>) {
  const client = await colyseus.connectTo(room, { name: `Tester${++seatCount}` });
  const player = room.state.players.get(client.sessionId)!;
  player.x = MAP.width / 2 + Math.random() * 100 - 50;
  player.y = MAP.height / 2 + Math.random() * 100 - 50;
  return client;
}

async function seatAndPlay(room: ServerRoom<GameState>, count: number) {
  const clients = [];
  for (let i = 0; i < count; i++) {
    clients.push(await seat(room));
  }
  clients[0]!.send("start");
  await tick(4);
  await new Promise((resolve) => setTimeout(resolve, ROLE_REVEAL_MS + 200));
  return clients;
}

/** Every queued input command a client sends drives one simulated step of movement — this is what makes a tick's input-apply loop non-trivial to measure. */
function sendMovement(client: Awaited<ReturnType<typeof seat>>, seq: number): void {
  client.send("input", { seq, dir: { x: Math.random() > 0.5 ? 1 : -1, y: Math.random() > 0.5 ? 1 : -1 } });
}

/** p95 from a prom-client Histogram's cumulative bucket counts — the smallest bucket boundary whose cumulative count covers 95% of observations. */
function p95FromHistogram(values: Array<{ metricName?: string; labels: Record<string, unknown>; value: number }>): number {
  const buckets = values
    .filter((v) => v.metricName?.endsWith("_bucket"))
    .map((v) => ({ le: Number(v.labels.le), count: v.value }))
    .sort((a, b) => a.le - b.le);
  const total = buckets.find((b) => b.le === Infinity)?.count ?? 0;
  if (total === 0) {
    return 0;
  }
  const threshold = total * 0.95;
  const hit = buckets.find((b) => b.count >= threshold);
  return hit ? hit.le : Infinity;
}

describe("GameRoom tick performance", () => {
  it("keeps p95 tick duration under 10ms with 12 players mid-round", async () => {
    const room = await colyseus.createRoom<GameState>("game");
    const clients = await seatAndPlay(room, 12);

    // Drive real movement traffic for a couple of seconds of ticks — an idle
    // room's input-apply loop does nothing (see GameRoom.ts's `steps <= 0`
    // early-return per player), so this exercises the loop the acceptance
    // check actually cares about, not just the always-on fog heartbeat.
    let seq = 0;
    for (let round = 0; round < 40; round++) {
      for (const client of clients) {
        sendMovement(client, ++seq);
      }
      await tick(1);
    }

    const { values } = await tickDurationMs.get();
    const p95 = p95FromHistogram(values);

    // A stricter bar than the histogram's own bucket comment (50ms budget
    // at 20Hz/TICK_RATE) documents — see metrics.ts.
    expect(p95).toBeLessThan(10);
  }, 30_000);
});
