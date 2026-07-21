import { CRITICAL_SABOTAGE_COUNTDOWN_MS } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The Saboteur's critical sabotage — a Lighthouse failure/flooding. No
 * target: starts a `CRITICAL_SABOTAGE_COUNTDOWN_MS` clock the town must
 * repair both `CRITICAL_REPAIR_POINTS` within, or the Strangers win the game
 * outright (see `GameRoom.resolveCriticalSabotage`). The Strangers' win path
 * that isn't killing.
 *
 * Self-gated: rejects if one is already running (fires nothing, costs
 * nothing) — `ctx.triggerCriticalSabotage` returns false in that case. Every
 * OTHER sabotage-family ability self-gates on `criticalSabotageActive` in
 * turn, so once this fires, nothing else sabotage-shaped can until it
 * resolves.
 */
export const criticalSabotageAbility: Ability = {
  id: "critical_sabotage",
  execute(ctx) {
    return ctx.triggerCriticalSabotage(CRITICAL_SABOTAGE_COUNTDOWN_MS);
  },
};
