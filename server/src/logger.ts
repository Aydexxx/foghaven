import pino from "pino";

/**
 * The one process-wide structured logger. JSON to stdout — no separate log
 * destination to configure or fail: Railway's log viewer already captures and
 * displays stdout, and Grafana Cloud (or any other drain) can be pointed at
 * the same stream later without a code change here.
 *
 * `pino`'s default level is "info"; set `LOG_LEVEL` to override (e.g. "debug"
 * locally, "warn" to quiet a noisy environment).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Node's Date.now()-based ISO timestamp reads far better in a log viewer
  // than pino's default epoch-ms `time` field.
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;

/** A child logger stamped with `roomId` — every log line a room emits should go through this rather than the bare `logger`. */
export function roomLogger(roomId: string): Logger {
  return logger.child({ roomId });
}
