import { KILL_RANGE } from "@foghaven/shared";
import { protectedIds, type Ability } from "./types";

/**
 * The stranger's kill. Every target rule the old `handleKill` enforced,
 * unchanged in effect:
 *   - the victim must exist, be alive, and not be the actor
 *   - no killing within your own faction (what used to be the
 *     fellow-stranger guard, stated generally)
 *   - the victim must be within `KILL_RANGE` of the actor's *server-side*
 *     position, with no wall between
 *
 * A shielded victim (see `protect.ts`) survives: the shield is consumed and
 * the ability still "fires" — the killer pays their full cooldown and gets
 * no `killConfirmed`, no body appears, and no message tells anyone why.
 * The missing corpse is the only tell, and that ambiguity is the point:
 * announcing the block would out both the doctor's presence and the
 * killer's attempt.
 */
export const killAbility: Ability = {
  id: "kill",
  execute(ctx) {
    const { targetId, target } = ctx;
    if (!targetId || targetId === ctx.actorId) {
      return false;
    }
    if (!target || !target.alive) {
      return false;
    }
    if (ctx.factionOf(targetId) === ctx.factionOf(ctx.actorId)) {
      return false;
    }
    if (!ctx.withinRange(ctx.actor, target, KILL_RANGE)) {
      return false;
    }
    if (!ctx.canSee(ctx.actor, target)) {
      return false;
    }

    const shielded = protectedIds(ctx.roundStore);
    if (shielded.has(targetId)) {
      shielded.delete(targetId);
      return true;
    }

    ctx.kill(target);
    // The killer's own confirmation cue, kept separate from the ability
    // cooldown message so the client has one unambiguous "that landed"
    // signal — see the doc that used to live on `handleKill`.
    ctx.sendToActor("killConfirmed");
    return true;
  },
};
