import { COMMS_SABOTAGE_DURATION_MS } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The Saboteur's comms sabotage. No target — blacks out the task list and
 * room labels for every client for `COMMS_SABOTAGE_DURATION_MS` (see
 * `GameState.commsSabotageActive`). Quieter than the fog or critical
 * sabotages: no alarm, no vision change, just the town's situational
 * awareness going dark for a while.
 *
 * Self-gated on `criticalSabotageActive`: no other sabotage fires while a
 * critical failure has the town's full attention.
 */
export const commsAbility: Ability = {
  id: "comms",
  execute(ctx) {
    if (ctx.criticalSabotageActive) {
      return false;
    }
    ctx.triggerComms(COMMS_SABOTAGE_DURATION_MS);
    return true;
  },
};
