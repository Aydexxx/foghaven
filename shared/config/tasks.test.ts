import { describe, expect, it } from "vitest";
import { TASK_ROOM_ANCHOR } from "../map/townMap";
import {
  TASK_BAND_BOUNDS,
  TASK_DEFINITIONS,
  TASK_DEFINITIONS_BY_ID,
  TASK_TIER_BUDGET,
  type MinigameType,
} from "./tasks";

/**
 * §8.3's remap of the placeholder task roster onto the six named harbour
 * mini-games. `server/src/map.test.ts` already pins the room-coverage
 * invariant (one task per task-eligible room) and
 * `server/src/rooms/GameRoomTaskFramework.test.ts` already pins the tier
 * budget generically; this file is the id-and-mechanic-specific half —
 * exactly the part a future room reshuffle is most likely to get wrong by
 * accident, since nothing else would catch a copy-pasted id or a tier that
 * quietly drifted off its intended task.
 */

describe("§8.3 the task roster", () => {
  it("gives every task a unique id", () => {
    const ids = TASK_DEFINITIONS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses every one of the six mini-games at least once", () => {
    const used = new Set(TASK_DEFINITIONS.map((task) => task.minigame));
    const all: MinigameType[] = ["wick", "net", "gear", "bilge", "ledger", "crane"];
    for (const type of all) {
      expect(used.has(type), `no task uses "${type}"`).toBe(true);
    }
  });

  it("gives `wick` and `net` exactly two tasks each — the rest exactly one", () => {
    const counts = new Map<MinigameType, number>();
    for (const task of TASK_DEFINITIONS) {
      counts.set(task.minigame, (counts.get(task.minigame) ?? 0) + 1);
    }
    expect(counts.get("wick")).toBe(2);
    expect(counts.get("net")).toBe(2);
    for (const solo of ["gear", "bilge", "ledger", "crane"] as const) {
      expect(counts.get(solo), solo).toBe(1);
    }
  });

  it("puts the injury tier on Wind the Lighthouse Gear and nowhere else", () => {
    const injured = TASK_DEFINITIONS.filter((task) => task.tier === "injury");
    expect(injured.map((task) => task.id)).toEqual(["wind-the-lighthouse-gear"]);
    expect(injured[0]!.minigame).toBe("gear");
  });

  it("puts the lethal tier on Haul the Crane and nowhere else", () => {
    const lethal = TASK_DEFINITIONS.filter((task) => task.tier === "lethal");
    expect(lethal.map((task) => task.id)).toEqual(["haul-the-crane"]);
    expect(lethal[0]!.minigame).toBe("crane");
  });

  it("keeps a strict safe majority — six of eight", () => {
    const safe = TASK_DEFINITIONS.filter((task) => task.tier === "safe");
    expect(safe.length).toBe(6);
  });

  it("stays inside the declared tier budget", () => {
    const counts = { safe: 0, injury: 0, lethal: 0 };
    for (const task of TASK_DEFINITIONS) {
      counts[task.tier] += 1;
    }
    expect(counts.injury).toBeLessThanOrEqual(TASK_TIER_BUDGET.injury);
    expect(counts.lethal).toBeLessThanOrEqual(TASK_TIER_BUDGET.lethal);
  });

  it("covers every task-eligible room exactly once", () => {
    const rooms = TASK_DEFINITIONS.map((task) => task.room);
    expect(new Set(rooms).size).toBe(rooms.length);
    expect(new Set(rooms).size).toBe(Object.keys(TASK_ROOM_ANCHOR).length);
  });

  it("gives every task a band with real, ordered bounds", () => {
    for (const task of TASK_DEFINITIONS) {
      const bounds = TASK_BAND_BOUNDS[task.band];
      expect(bounds, task.id).toBeDefined();
      expect(bounds.minMs).toBeLessThan(bounds.maxMs);
    }
  });

  it("gives every task at least one step", () => {
    for (const task of TASK_DEFINITIONS) {
      expect(task.steps.length, task.id).toBeGreaterThan(0);
    }
  });

  it("resolves every id through the lookup map to the exact same object", () => {
    for (const task of TASK_DEFINITIONS) {
      expect(TASK_DEFINITIONS_BY_ID.get(task.id)).toBe(task);
    }
  });
});
