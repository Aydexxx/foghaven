import { KILL_RANGE } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The doctor's second ability: put an injured player back to healthy.
 *
 * Target rules are deliberately the same shape as `protect`'s — a living
 * player other than yourself, within `KILL_RANGE`, with no wall between —
 * so "who can I reach" means one thing for the whole role rather than two.
 *
 * ## This one is not silent, and that is the design
 *
 * `protect` goes to great lengths to reveal nothing: the target is never
 * told, and nobody sees it trigger. `heal` cannot do that and should not try.
 * `Player.condition` is public on purpose (docs/ROADMAP_PHASE8.md pillar 1 —
 * "why are you limping?" is meant to be asked out loud), so a limp visibly
 * stopping is information the room is entitled to, and anyone standing close
 * enough to watch it happen can reasonably guess who the doctor is.
 *
 * That is a real cost to the doctor and it is the intended trade: the shield
 * is the quiet play, the heal is the one that might out you. Hiding it would
 * mean making injury itself private, which would delete the mechanic.
 *
 * ## Why healing a healthy player is not a rejection
 *
 * `ctx.heal` returns false for a target who was not injured, but this still
 * returns true — the ability fires, pays its cooldown and consumes its use.
 * Refusing instead would turn the ability button into an injury detector: a
 * doctor could probe a target they cannot clearly see and learn their
 * condition from whether the attempt was accepted. Condition is already
 * public to anyone who can SEE the target, and this keeps it to exactly
 * that — no more, and no less.
 */
export const healAbility: Ability = {
  id: "heal",
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

    ctx.heal(target);
    // The doctor's own confirmation, exactly as `protect` sends one: it tells
    // them their action landed and nothing about the target they did not
    // already have by looking at them.
    ctx.sendToActor("abilityEffect", { type: "healed", targetId });
    return true;
  },
};
