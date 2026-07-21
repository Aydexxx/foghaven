import { KILL_RANGE } from "@foghaven/shared";
import { protectedIds, type Ability } from "./types";

/**
 * The doctor's shield. Marks a nearby living player as protected; the next
 * kill against them is silently absorbed instead (see `kill.ts`). The
 * shield lasts until it absorbs a kill or the round of play ends — the
 * round store it lives in is cleared at every meeting.
 *
 * Silent toward everyone EXCEPT the doctor themselves: the target is never
 * told they are shielded, and nobody else is told when it triggers — that
 * would be information about who the doctor is standing near, exactly the
 * kind of inference the fog and the private role messages elsewhere are
 * built to prevent. The doctor privately confirming their OWN action back
 * to themselves leaks nothing new — they already chose the target — and is
 * what lets the client draw the "faintly visible" shield on that one
 * sprite, on the doctor's own screen only.
 *
 * The doctor doesn't know roles, so they may shield a stranger. Allowed:
 * refusing would BE a role test, and the kill ability's same-faction guard
 * already means a shielded stranger changes nothing.
 */
export const protectAbility: Ability = {
  id: "protect",
  execute(ctx) {
    const { targetId, target } = ctx;
    if (!targetId || targetId === ctx.actorId) {
      return false;
    }
    if (!target || !target.alive) {
      return false;
    }
    if (!ctx.withinRange(ctx.actor, target, KILL_RANGE)) {
      return false;
    }
    if (!ctx.canSee(ctx.actor, target)) {
      return false;
    }

    protectedIds(ctx.roundStore).add(targetId);
    ctx.sendToActor("abilityEffect", { type: "shielded", targetId });
    return true;
  },
};
