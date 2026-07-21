import { FACTION, MEETING_STAGE } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The constable's public execution. Usable during a meeting's discussion or
 * ballot — not once results are already resolving, and not during open
 * play, where a silent kill already belongs to the stranger's own ability.
 * No range or line-of-sight check: the fog does not apply during a meeting
 * either (see `FOG_PHASES` on the schema), and everyone is already gathered
 * in one place.
 *
 * High risk by design: killing a Stranger is a clean win for the town, but
 * killing anyone else takes the constable down with them — mutual death,
 * checked by faction so it reads correctly for any future faction, not just
 * today's two.
 */
export const executeShotAbility: Ability = {
  id: "execute_shot",
  execute(ctx) {
    if (ctx.meetingStage === MEETING_STAGE.RESULTS || ctx.meetingStage === "") {
      return false;
    }
    const { targetId, target } = ctx;
    if (!targetId || targetId === ctx.actorId) {
      return false;
    }
    if (!target || !target.alive) {
      return false;
    }

    ctx.kill(target);
    if (ctx.factionOf(targetId) !== FACTION.STRANGER) {
      ctx.kill(ctx.actor);
    }
    return true;
  },
};
