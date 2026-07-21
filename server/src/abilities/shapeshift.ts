import { SHAPESHIFT_DURATION_MS } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The Shapeshifter's disguise. Takes on the target's name and appearance for
 * `SHAPESHIFT_DURATION_MS` — see `GameRoom.disguiseAs` for why this swaps the
 * real public `name`/`color` fields rather than adding sibling "disguise"
 * fields: a sibling field would leave the real values sitting on the wire
 * right next to it, readable by anyone inspecting raw traffic, which defeats
 * the whole point. No self-targeting; the target must be alive (disguising
 * as a body has nothing to destroy — the corpse already speaks for itself).
 */
export const shapeshiftAbility: Ability = {
  id: "shapeshift",
  execute(ctx) {
    const { targetId, target } = ctx;
    if (!targetId || targetId === ctx.actorId) {
      return false;
    }
    if (!target || !target.alive) {
      return false;
    }
    ctx.disguiseAs(targetId, SHAPESHIFT_DURATION_MS);
    return true;
  },
};
