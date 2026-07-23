import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStatsProvider } from "./provider";

let provider: InMemoryStatsProvider;

beforeEach(() => {
  provider = new InMemoryStatsProvider();
});

describe("getStats", () => {
  it("is all zeroes for an account with no games recorded", async () => {
    const stats = await provider.getStats("u1");
    expect(stats).toEqual({
      gamesPlayed: 0,
      gamesWon: 0,
      gamesSurvived: 0,
      tasksCompleted: 0,
      totalSurvivalTimeMs: 0,
      winRate: 0,
      averageSurvivalTimeMs: 0,
      roleStats: [],
    });
  });
});

describe("recordGameResults", () => {
  it("accumulates totals across multiple games", async () => {
    await provider.recordGameResults([
      { userId: "u1", role: "villager", won: true, survived: true, tasksCompleted: 3, survivalTimeMs: 100_000 },
    ]);
    await provider.recordGameResults([
      { userId: "u1", role: "doctor", won: false, survived: false, tasksCompleted: 2, survivalTimeMs: 40_000 },
    ]);

    const stats = await provider.getStats("u1");
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.gamesWon).toBe(1);
    expect(stats.gamesSurvived).toBe(1);
    expect(stats.tasksCompleted).toBe(5);
    expect(stats.totalSurvivalTimeMs).toBe(140_000);
    expect(stats.winRate).toBe(0.5);
    expect(stats.averageSurvivalTimeMs).toBe(70_000);
  });

  it("keeps per-role totals separate and independent of the overall line", async () => {
    await provider.recordGameResults([
      { userId: "u1", role: "villager", won: true, survived: true, tasksCompleted: 1, survivalTimeMs: 1000 },
      { userId: "u1", role: "villager", won: false, survived: true, tasksCompleted: 1, survivalTimeMs: 1000 },
      { userId: "u1", role: "stranger", won: true, survived: true, tasksCompleted: 1, survivalTimeMs: 1000 },
    ]);

    const stats = await provider.getStats("u1");
    expect(stats.gamesPlayed).toBe(3);
    const villager = stats.roleStats.find((r) => r.role === "villager");
    const stranger = stats.roleStats.find((r) => r.role === "stranger");
    expect(villager).toEqual({ role: "villager", gamesPlayed: 2, gamesWon: 1 });
    expect(stranger).toEqual({ role: "stranger", gamesPlayed: 1, gamesWon: 1 });
  });

  it("keeps stats separate per user", async () => {
    await provider.recordGameResults([
      { userId: "u1", role: "villager", won: true, survived: true, tasksCompleted: 5, survivalTimeMs: 5000 },
    ]);
    const other = await provider.getStats("u2");
    expect(other.gamesPlayed).toBe(0);
  });

  it("applies every entry in a batch (multiple players from one game)", async () => {
    await provider.recordGameResults([
      { userId: "u1", role: "villager", won: true, survived: true, tasksCompleted: 4, survivalTimeMs: 60_000 },
      { userId: "u2", role: "stranger", won: false, survived: false, tasksCompleted: 0, survivalTimeMs: 20_000 },
    ]);
    expect((await provider.getStats("u1")).gamesWon).toBe(1);
    expect((await provider.getStats("u2")).gamesWon).toBe(0);
    expect((await provider.getStats("u2")).gamesSurvived).toBe(0);
  });

  it("is a no-op for an empty batch", async () => {
    await provider.recordGameResults([]);
    expect((await provider.getStats("u1")).gamesPlayed).toBe(0);
  });
});
