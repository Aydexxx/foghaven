import { SABOTAGE_DURATION_MS } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The base Stranger's sabotage. No target — it darkens the whole town's
 * vision (see `visionRadiusAt`'s `sabotageActive` parameter) for everyone,
 * the Stranger included; there is no faction-aware exemption here, because
 * `Player` deliberately carries no faction in public state (see its own doc
 * comment) and a per-viewer branch would need one. Everything else a
 * sabotage triggers — the bell lock, the alarm stinger/tension music, the
 * atmosphere color grade, watchman camera blinding — already reads
 * `state.sabotageActive` and needs no changes; this ability is the one thing
 * that was missing to ever set it true.
 *
 * Self-gated on `criticalSabotageActive`: no other sabotage fires while a
 * critical failure has the town's full attention.
 */
export const sabotageAbility: Ability = {
  id: "sabotage",
  execute(ctx) {
    if (ctx.criticalSabotageActive) {
      return false;
    }
    ctx.triggerSabotage(SABOTAGE_DURATION_MS);
    return true;
  },
};
