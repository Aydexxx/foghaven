import type { Ability } from "./types";

/**
 * The Silencer's gag. Targets a living player; the effect doesn't apply
 * immediately — it's held until the next meeting starts (see
 * `GameRoom.pendingSilence` / `startMeeting`'s drain into
 * `silencedThisMeeting`), which is when the target is privately told they've
 * been silenced and their chat is rejected for that one meeting.
 */
export const silenceAbility: Ability = {
  id: "silence",
  execute(ctx) {
    const { targetId, target } = ctx;
    if (!targetId || targetId === ctx.actorId) {
      return false;
    }
    if (!target || !target.alive) {
      return false;
    }
    ctx.pendingSilence(targetId);
    return true;
  },
};
