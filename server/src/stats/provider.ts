import type { PrismaClient } from "@prisma/client";
import type { PlayerStats, RoleStatSummary } from "@foghaven/shared";

/**
 * Lifetime stats behind the profile screen — the same swappable-provider seam
 * `auth/`, `friends/`, `moderation/` and `cosmetics/` all use, and for the
 * same reason: the whole test suite runs with no database at all.
 *
 * There is deliberately no route or method here that takes anyone's id but
 * the caller's own (see `server/src/http/statsRoutes.ts`) — that is what
 * keeps this from ever growing into a leaderboard.
 */

/** One player's outcome from a single finished game — see `GameRoom.recordGameStats`. */
export interface GameStatEntry {
  userId: string;
  /** A `ROLES` id from the shared role registry. */
  role: string;
  won: boolean;
  /** Still alive when the round ended, win or lose. */
  survived: boolean;
  tasksCompleted: number;
  survivalTimeMs: number;
}

export interface StatsProvider {
  /**
   * Apply every entry from one finished game as a single batch. Called
   * exactly once per game, at `declareGameOver` — never per task, per kill,
   * or per vote — which is what keeps this from becoming a write on every
   * gameplay event.
   */
  recordGameResults(entries: GameStatEntry[]): Promise<void>;
  /** This account's lifetime stat line — zeroed out if it has never played. */
  getStats(userId: string): Promise<PlayerStats>;
}

interface RawTotals {
  gamesPlayed: number;
  gamesWon: number;
  gamesSurvived: number;
  tasksCompleted: number;
  totalSurvivalTimeMs: number;
}

const EMPTY_TOTALS: RawTotals = {
  gamesPlayed: 0,
  gamesWon: 0,
  gamesSurvived: 0,
  tasksCompleted: 0,
  totalSurvivalTimeMs: 0,
};

/** `winRate`/`averageSurvivalTimeMs` are derived here, never stored — see the schema doc on `UserStats`. */
function toPlayerStats(totals: RawTotals, roleStats: RoleStatSummary[]): PlayerStats {
  return {
    ...totals,
    winRate: totals.gamesPlayed > 0 ? totals.gamesWon / totals.gamesPlayed : 0,
    averageSurvivalTimeMs:
      totals.gamesPlayed > 0 ? Math.round(totals.totalSurvivalTimeMs / totals.gamesPlayed) : 0,
    roleStats,
  };
}

// --- Prisma implementation ---------------------------------------------

export class PrismaStatsProvider implements StatsProvider {
  constructor(private readonly prisma: PrismaClient) {}

  async recordGameResults(entries: GameStatEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const ops = entries.flatMap((entry) => [
      this.prisma.userStats.upsert({
        where: { userId: entry.userId },
        create: {
          userId: entry.userId,
          gamesPlayed: 1,
          gamesWon: entry.won ? 1 : 0,
          gamesSurvived: entry.survived ? 1 : 0,
          tasksCompleted: entry.tasksCompleted,
          totalSurvivalTimeMs: entry.survivalTimeMs,
        },
        update: {
          gamesPlayed: { increment: 1 },
          gamesWon: { increment: entry.won ? 1 : 0 },
          gamesSurvived: { increment: entry.survived ? 1 : 0 },
          tasksCompleted: { increment: entry.tasksCompleted },
          totalSurvivalTimeMs: { increment: entry.survivalTimeMs },
        },
      }),
      this.prisma.userRoleStats.upsert({
        where: { userId_role: { userId: entry.userId, role: entry.role } },
        create: { userId: entry.userId, role: entry.role, gamesPlayed: 1, gamesWon: entry.won ? 1 : 0 },
        update: { gamesPlayed: { increment: 1 }, gamesWon: { increment: entry.won ? 1 : 0 } },
      }),
    ]);
    // One transaction for the whole game: every seated account's line moves
    // together, so a mid-batch failure can never leave some players counted
    // for a round and others not.
    await this.prisma.$transaction(ops);
  }

  async getStats(userId: string): Promise<PlayerStats> {
    const [totals, roleRows] = await Promise.all([
      this.prisma.userStats.findUnique({ where: { userId } }),
      this.prisma.userRoleStats.findMany({
        where: { userId },
        orderBy: { gamesPlayed: "desc" },
      }),
    ]);
    const roleStats = roleRows.map((row) => ({
      role: row.role,
      gamesPlayed: row.gamesPlayed,
      gamesWon: row.gamesWon,
    }));
    return toPlayerStats(totals ?? EMPTY_TOTALS, roleStats);
  }
}

// --- In-memory implementation (tests) -----------------------------------

/** A RAM-backed provider for tests — same rules as the real one, no database. */
export class InMemoryStatsProvider implements StatsProvider {
  private readonly totals = new Map<string, RawTotals>();
  private readonly roleStats = new Map<string, Map<string, RoleStatSummary>>();

  async recordGameResults(entries: GameStatEntry[]): Promise<void> {
    for (const entry of entries) {
      const totals = { ...(this.totals.get(entry.userId) ?? EMPTY_TOTALS) };
      totals.gamesPlayed += 1;
      totals.gamesWon += entry.won ? 1 : 0;
      totals.gamesSurvived += entry.survived ? 1 : 0;
      totals.tasksCompleted += entry.tasksCompleted;
      totals.totalSurvivalTimeMs += entry.survivalTimeMs;
      this.totals.set(entry.userId, totals);

      const roles = this.roleStats.get(entry.userId) ?? new Map<string, RoleStatSummary>();
      const role = roles.get(entry.role) ?? { role: entry.role, gamesPlayed: 0, gamesWon: 0 };
      role.gamesPlayed += 1;
      role.gamesWon += entry.won ? 1 : 0;
      roles.set(entry.role, role);
      this.roleStats.set(entry.userId, roles);
    }
  }

  async getStats(userId: string): Promise<PlayerStats> {
    const totals = this.totals.get(userId) ?? EMPTY_TOTALS;
    const roleStats = [...(this.roleStats.get(userId)?.values() ?? [])];
    return toPlayerStats(totals, roleStats);
  }

  reset(): void {
    this.totals.clear();
    this.roleStats.clear();
  }
}

// --- Swappable registry --------------------------------------------------

let current: StatsProvider | null = null;

export function setStatsProvider(provider: StatsProvider | null): void {
  current = provider;
}

/** The active provider, or null when none is installed — see `getCosmeticProvider` for why this doesn't throw. */
export function getStatsProvider(): StatsProvider | null {
  return current;
}
