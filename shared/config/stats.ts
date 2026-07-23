/**
 * The stats system's wire shapes and derived badges. Shared so the client
 * never has to re-derive win rate or badge eligibility differently than the
 * server would — both compute from the exact same `PlayerStats` shape (see
 * `server/src/stats/provider.ts`'s `PrismaStatsProvider`/`InMemoryStatsProvider`
 * for where the raw counters live, and `GameRoom.recordGameStats` for the one
 * place a game actually adds to them).
 *
 * Deliberately no leaderboard-shaped API anywhere near this file: every stats
 * route only ever answers for the caller's own account (see
 * `server/src/http/statsRoutes.ts`), so there is nothing here that could sort
 * or compare players against each other.
 */

/** One role's lifetime record for a single account. */
export interface RoleStatSummary {
  /** A `ROLES` id — see `shared/game/roles.ts`. */
  role: string;
  gamesPlayed: number;
  gamesWon: number;
}

/** An account's full lifetime stat line, as returned by `GET /stats`. */
export interface PlayerStats {
  gamesPlayed: number;
  gamesWon: number;
  /** Games this account was still alive when the round ended, win or lose. */
  gamesSurvived: number;
  /** Total task steps completed across every game, real or (as a stranger) fake. */
  tasksCompleted: number;
  totalSurvivalTimeMs: number;
  /** `gamesWon / gamesPlayed`, or 0 with nothing played yet. */
  winRate: number;
  /** `totalSurvivalTimeMs / gamesPlayed`, or 0 with nothing played yet. */
  averageSurvivalTimeMs: number;
  roleStats: RoleStatSummary[];
}

/** A stat line for an account with no games recorded yet. */
export const EMPTY_PLAYER_STATS: PlayerStats = {
  gamesPlayed: 0,
  gamesWon: 0,
  gamesSurvived: 0,
  tasksCompleted: 0,
  totalSurvivalTimeMs: 0,
  winRate: 0,
  averageSurvivalTimeMs: 0,
  roleStats: [],
};

/**
 * Badges are purely derived from `PlayerStats` — there is no badge table and
 * nothing is ever "awarded"; a badge is simply earned the instant its
 * threshold is met, computed fresh every time a profile is read. That keeps
 * this list editable (add a threshold, everyone's profile picks it up) without
 * a migration or a backfill job.
 */
export interface BadgeDefinition {
  id: string;
  isEarned: (stats: PlayerStats) => boolean;
}

export const BADGE_DEFINITIONS: readonly BadgeDefinition[] = [
  { id: "first_win", isEarned: (s) => s.gamesWon >= 1 },
  { id: "regular", isEarned: (s) => s.gamesPlayed >= 10 },
  { id: "veteran", isEarned: (s) => s.gamesPlayed >= 50 },
  { id: "task_master", isEarned: (s) => s.tasksCompleted >= 100 },
  { id: "survivor", isEarned: (s) => s.gamesSurvived >= 10 },
  { id: "sharpshooter", isEarned: (s) => s.gamesPlayed >= 10 && s.winRate >= 0.6 },
];

export type BadgeId = (typeof BADGE_DEFINITIONS)[number]["id"];

/** Every badge this stat line currently qualifies for. */
export function earnedBadges(stats: PlayerStats): string[] {
  return BADGE_DEFINITIONS.filter((badge) => badge.isEarned(stats)).map((badge) => badge.id);
}
