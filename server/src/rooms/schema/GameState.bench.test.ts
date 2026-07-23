import { describe, expect, it } from "vitest";
import { PHASE } from "@foghaven/shared";
import { GameState, Player, Body } from "./GameState";

/**
 * Measures actual encoded byte sizes for a 12-player round — the "measure
 * delta size" half of the network audit. Deliberately built on a STANDALONE
 * `GameState` instance, never attached to a real `Room`/connected clients:
 * `Schema.encode()`/`encodeAll()` mutate the instance's internal change-
 * tracking state as a side effect (consuming the pending-changes list), so
 * calling them on a *live* room's real state — which Colyseus's own patch
 * cycle also encodes on its own interval — would risk corrupting that cycle
 * (double-consuming changes meant for real connected clients). An isolated
 * instance has no live encode cycle to interfere with, so this is safe.
 *
 * `useFilters: false` is intentional: without a real connected client there
 * is no per-viewer fog to filter by, so this measures the pre-filter
 * "everything that changed" payload — the same upper bound every client's
 * `@filterChildren`-narrowed patch is drawn from (never larger, so bytes
 * actually sent to any one client are always ≤ these numbers).
 */
function seedState(playerCount: number, bodyCount: number): GameState {
  const state = new GameState();
  state.phase = PHASE.PLAYING;

  for (let i = 0; i < playerCount; i++) {
    const player = new Player();
    player.id = `session-${i}`;
    player.name = `Player ${i}`;
    player.x = 100 + i * 10;
    player.y = 200 + i * 10;
    player.color = "#e6194b";
    state.players.set(player.id, player);
  }

  for (let i = 0; i < bodyCount; i++) {
    const body = new Body();
    body.playerId = `session-${i}`;
    body.name = `Player ${i}`;
    body.x = 300 + i * 10;
    body.y = 400 + i * 10;
    body.color = "#3cb44b";
    state.bodies.set(body.playerId, body);
  }

  return state;
}

/**
 * `encodeAll()` (encodeAll=true) does NOT discard pending changes on its own
 * — checked directly against the encoder source: the discard-after-encode
 * step only runs when `!encodeAll && !useFilters`. So the very first
 * unfiltered non-encodeAll `encode()` call after seeding still re-encodes
 * (and then finally discards) all of the initial ADD changes — this flush
 * is what settling "as a real first client would" actually requires, and
 * every subsequent measurement in this file calls it first so it isn't
 * silently measuring leftover creation noise instead of the thing each test
 * claims to measure.
 */
function flush(state: GameState): void {
  state.encode(false, [], false);
}

/** Mirrors GameRoom.update()'s per-tick fog heartbeat exactly (see GameRoom.ts). */
function applyTickHeartbeat(state: GameState): void {
  state.players.forEach((player) => {
    player.setDirty("x");
    player.setDirty("y");
  });
  state.bodies.forEach((body) => {
    body.setDirty("x");
    body.setDirty("y");
  });
}

describe("GameState encoded size (12 players)", () => {
  it("reports the full initial sync size", () => {
    const state = seedState(12, 2);
    const bytes = state.encodeAll(false);
    expect(bytes.length).toBeGreaterThan(0);
    // Generous ceiling, not a tight budget — this is a visibility check
    // (fails loudly if the schema balloons unexpectedly), not a strict
    // performance gate.
    expect(bytes.length).toBeLessThan(4000);
  });

  it("reports one tick's incremental patch size under the fog heartbeat", () => {
    const state = seedState(12, 2);
    state.encodeAll(false);
    flush(state); // settle the initial full sync, as a real first client would.

    applyTickHeartbeat(state);
    const patchBytes = state.encode(false, [], false);

    expect(patchBytes.length).toBeGreaterThan(0);
    // The heartbeat touches x/y for every player+body every tick — this is
    // the real per-tick cost the fog-liveness mechanism buys (see the
    // GameRoom.ts comment at the heartbeat's call site). A regression here
    // (this number growing much faster than player count) would be the
    // signal that something new is being needlessly re-dirtied every tick.
    expect(patchBytes.length).toBeLessThan(1500);
  });

  it("an idle tick (no movement, no heartbeat) encodes to nothing", () => {
    const state = seedState(12, 2);
    state.encodeAll(false);
    flush(state);

    // No setDirty calls at all — simulates a tick outside PLAYING (e.g.
    // MEETING/GAME_OVER), where GameRoom.update() skips the heartbeat
    // entirely (see GameRoom.ts's early-return + the `phase === PLAYING`
    // guard around the heartbeat).
    const patchBytes = state.encode(false, [], false);
    expect(patchBytes.length).toBe(0);
  });
});
