import type { Logger } from "./logger";
import { anticheatRejections } from "./metrics";

/**
 * Every reason a rejection is worth logging as a suspicious request, rather
 * than a benign UI-timing race. Keeping this as a closed union (not a bare
 * string) is what keeps `foghaven_anticheat_rejections_total`'s `reason`
 * label from silently growing an unbounded cardinality one typo at a time.
 */
export type AntiCheatReason =
  | "join_banned"
  | "join_blocked"
  | "ability_spoof"
  | "ability_cooldown"
  | "ability_no_uses"
  | "repair_out_of_range"
  | "report_fog_of_war"
  | "meeting_quota"
  | "chat_rate_limit"
  | "chat_profanity"
  | "report_rate_limit"
  /**
   * A task attempt claimed to resolve faster than its band's `minMs` allows
   * (8.2). Distinct from the ordinary rejections above because there is no
   * benign race that produces it: the client itself was told the deadline
   * when the attempt opened, so a too-fast claim is either a modified client
   * or a replayed message.
   */
  | "task_too_fast";

export interface AntiCheatContext {
  sessionId: string;
  /** The durable account id, when known — null for a guest or an unresolved session. */
  userId?: string | null;
  /** Small, JSON-safe extra context specific to the reason (e.g. the ability id, the range exceeded). */
  detail?: Record<string, string | number | boolean | null>;
}

/**
 * Log one rejected, suspicious client request and count it. `log` should
 * already be a room-scoped child logger (see `GameRoom.log` / `logger.ts`'s
 * `roomLogger`) so `roomId` is stamped without repeating it at every call
 * site — this only adds the parts specific to the event itself.
 *
 * Deliberately just a structured log line plus a counter, not a new
 * persistence layer: it's meant to be filtered/graphed (Railway's log viewer,
 * or the `foghaven_anticheat_rejections_total` metric in Grafana), not
 * queried like a database table — see docs/DEPLOYMENT.md's Observability
 * section for where it's reviewed in practice.
 */
export function logAntiCheatEvent(log: Logger, reason: AntiCheatReason, context: AntiCheatContext): void {
  log.warn(
    {
      event: "anticheat_reject",
      reason,
      sessionId: context.sessionId,
      userId: context.userId ?? null,
      detail: context.detail,
    },
    `anti-cheat: rejected (${reason})`,
  );
  anticheatRejections.inc({ reason });
}
