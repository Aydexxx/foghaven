import { MEETING_STAGE, roleById } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The Assassin's guess. Names a target and a role during a meeting; if the
 * guess matches the target's exact secret role, they die on the spot (the
 * generic mid-meeting kill path already pushes them onto `deadPlayerIds`
 * immediately, same as the Constable's shot). A wrong guess ejects the
 * assassin instead, through the exact same public path a normal vote-eject
 * uses (see `ctx.ejectSelf` / `GameRoom.ejectPlayer`) — high risk, matching
 * the Constable's own "guess wrong, pay for it" shape.
 *
 * Usable any time a meeting is up except during the results reveal itself —
 * same gate `execute_shot` uses.
 */
export const assassinateAbility: Ability = {
  id: "assassinate",
  execute(ctx) {
    if (ctx.meetingStage === MEETING_STAGE.RESULTS) {
      return false;
    }
    const { targetId, target, guessedRole } = ctx;
    if (!targetId || targetId === ctx.actorId) {
      return false;
    }
    if (!target || !target.alive) {
      return false;
    }
    if (!guessedRole || !roleById(guessedRole)) {
      return false;
    }

    if (ctx.roleIdOf(targetId) === guessedRole) {
      ctx.kill(target);
    } else {
      ctx.ejectSelf();
    }
    return true;
  },
};
