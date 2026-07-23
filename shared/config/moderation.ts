/**
 * Moderation's shared vocabulary and tuning: the report reasons a player can
 * pick, the roles that can act on them, and the spam/mute numbers the server
 * enforces.
 *
 * Shared rather than server-only because the client needs the same reason list
 * to render the report dialog and the same role names to decide whether to
 * offer the admin panel at all — while the server treats both as
 * authoritative. A reason the client doesn't know about is a reason nobody can
 * file; a role the client invents gets it exactly nowhere, because every admin
 * route re-reads the caller's real role from the database.
 */

/** Why a player was reported. Stored verbatim on the report row. */
export const REPORT_REASON = {
  HARASSMENT: "harassment",
  HATE_SPEECH: "hate_speech",
  SPAM: "spam",
  CHEATING: "cheating",
  INAPPROPRIATE_NAME: "inappropriate_name",
  GRIEFING: "griefing",
  OTHER: "other",
} as const;

export type ReportReason = (typeof REPORT_REASON)[keyof typeof REPORT_REASON];

export const REPORT_REASONS: readonly ReportReason[] = Object.values(REPORT_REASON);

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}

/** Where a report is in a moderator's queue. */
export const REPORT_STATUS = {
  OPEN: "open",
  ACTIONED: "actioned",
  DISMISSED: "dismissed",
} as const;

export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS];

export function isReportStatus(value: unknown): value is ReportStatus {
  return (
    typeof value === "string" &&
    (Object.values(REPORT_STATUS) as readonly string[]).includes(value)
  );
}

/**
 * Account roles. `PLAYER` is everyone; `MODERATOR` can work the report queue
 * and issue bans; `ADMIN` additionally manages roles. Ordered so a numeric
 * comparison expresses "at least this privileged" — see {@link hasRole}.
 */
export const USER_ROLE = {
  PLAYER: "player",
  MODERATOR: "moderator",
  ADMIN: "admin",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

const ROLE_RANK: Record<UserRole, number> = {
  [USER_ROLE.PLAYER]: 0,
  [USER_ROLE.MODERATOR]: 1,
  [USER_ROLE.ADMIN]: 2,
};

/**
 * Whether `actual` is at least as privileged as `required`. An unknown role
 * string ranks below everything, so a corrupted or newly-invented value fails
 * closed rather than accidentally granting access.
 */
export function hasRole(actual: string | null | undefined, required: UserRole): boolean {
  const rank = ROLE_RANK[actual as UserRole];
  return rank !== undefined && rank >= ROLE_RANK[required];
}

// --- Chat spam limits ------------------------------------------------------

/**
 * The burst budget, on top of the per-message `CHAT_COOLDOWN_MS` gap. The
 * cooldown alone only stops a player *holding* the send key; this is what
 * stops a script pacing itself just above the cooldown and still flooding a
 * meeting. Generous enough that a fast typist in a heated meeting never
 * notices it.
 */
export const CHAT_BURST_MAX = 8;
export const CHAT_BURST_WINDOW_MS = 10_000;

/**
 * How many identical messages in a row are tolerated before the repeat is
 * treated as spam. Saying "vote red" twice is emphasis; five times is a flood.
 */
export const CHAT_REPEAT_MAX = 3;

/**
 * How long a player is muted for once they trip the spam limits. Deliberately
 * short — this is a speed bump against flooding, not a punishment; anything
 * worth punishing goes through a report and a real ban.
 */
export const SPAM_MUTE_MS = 30_000;

/** How many blocked (slur-tier) messages before the same automatic mute applies. */
export const BLOCKED_MESSAGE_MUTE_THRESHOLD = 3;

// --- Mutes -----------------------------------------------------------------

/** How long a vote-mute silences its target. Expires on its own; never persists past the room. */
export const VOTE_MUTE_MS = 180_000;

/**
 * The share of connected players who must vote to mute someone before it
 * takes effect. A simple majority of *other* players, so one or two people
 * cannot silence someone in a large room, and a full lobby ganging up on a
 * genuine problem still can.
 */
export const VOTE_MUTE_SHARE = 0.5;

/** Minimum connected players before vote-mute is available at all. */
export const VOTE_MUTE_MIN_PLAYERS = 4;

// --- Reports ---------------------------------------------------------------

/** How many chat lines are snapshotted onto a report as evidence. */
export const REPORT_CHAT_EXCERPT_LINES = 40;

/** Longest free-text note a reporter may attach. */
export const REPORT_NOTE_MAX_LENGTH = 500;

/** Per-reporter budget, so the report queue itself cannot be spammed. */
export const REPORT_RATE_MAX = 5;
export const REPORT_RATE_WINDOW_MS = 60_000;

// --- Retention -------------------------------------------------------------

/**
 * How long raw chat logs are kept for report review before being deleted.
 *
 * Reports snapshot their own evidence at filing time (see
 * `REPORT_CHAT_EXCERPT_LINES`), so a report stays reviewable after its
 * surrounding chat has aged out — which is what lets this window be short.
 * Everything past it is deleted outright rather than archived: retaining
 * players' conversations indefinitely on the chance they might one day be
 * useful is exactly the thing not to do.
 */
export const CHAT_LOG_RETENTION_DAYS = 30;

/** How often the retention sweep runs. */
export const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// --- Wire shapes -----------------------------------------------------------

/** Server → client, when a message the player sent was refused or altered. */
export interface ChatRejectedMessage {
  reason: "blocked" | "muted" | "rate_limited";
  /** When a mute is in force, when it lifts (epoch ms); absent otherwise. */
  mutedUntil?: number;
}

/** Server → client, acknowledging a filed report. */
export interface ReportAckMessage {
  ok: boolean;
  error?: "rate_limited" | "invalid" | "unavailable";
}
