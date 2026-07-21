import { REPORT_BODY_RANGE, roomSlugAt } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The detective's trace. Examine a body and learn of one player recently
 * seen in the room it was found in — *not* necessarily the killer, just
 * whoever was circumstantially nearby. Same proximity rules as reporting a
 * body (`REPORT_BODY_RANGE` + line of sight), because that's exactly what
 * this is: a closer look at a body already in range to report.
 *
 * Fires (consumes the round's one use) even when nobody recent turns up —
 * real detective work sometimes comes up empty, and that's still an answer
 * worth having rather than a silently wasted button press.
 */
export const investigateAbility: Ability = {
  id: "investigate",
  execute(ctx) {
    const { targetBody } = ctx;
    if (!targetBody) {
      return false;
    }
    if (!ctx.withinRange(ctx.actor, targetBody, REPORT_BODY_RANGE)) {
      return false;
    }
    if (!ctx.canSee(ctx.actor, targetBody)) {
      return false;
    }

    const room = roomSlugAt(targetBody.x, targetBody.y);
    const witness = ctx.findWitness(room, [ctx.actorId, targetBody.playerId]);
    ctx.sendToActor("investigateHint", {
      witnessName: witness?.name ?? null,
      apparentFaction: witness?.apparentFaction ?? null,
    });
    return true;
  },
};
