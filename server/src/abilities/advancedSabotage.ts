import { ADVANCED_SABOTAGE_DURATION_MS } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The Saboteur's stronger sabotage — the same effect as the base Stranger's
 * `sabotage` (see that file), just held longer. A separate ability id rather
 * than a parameterized `sabotage` so the registry reads literally: a role
 * gets exactly the ability entries listed for it, nothing shared implicitly.
 *
 * Self-gated on `criticalSabotageActive`: no other sabotage fires while a
 * critical failure has the town's full attention.
 */
export const advancedSabotageAbility: Ability = {
  id: "advanced_sabotage",
  execute(ctx) {
    if (ctx.criticalSabotageActive) {
      return false;
    }
    ctx.triggerSabotage(ADVANCED_SABOTAGE_DURATION_MS);
    return true;
  },
};
