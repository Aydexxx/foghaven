import type { Ability } from "./types";

/**
 * The medium's commune. No target — the server automatically surfaces one
 * factual clue about a dead player the medium hasn't heard about yet (see
 * `ctx.communeWithDead` and `GameRoom`'s `deathLocations` / `mediumRevealed`
 * maps). Deliberately not a channel to the dead themselves: the living/dead
 * chat wall stays exactly as strict as it already is everywhere else in
 * this game — this is the server handing over a fact it already knows, not
 * a message from another player.
 *
 * Always fires: an empty pool ("the dead are silent") is itself the answer,
 * and still costs the round's one use — same reasoning as `investigate`.
 */
export const communeAbility: Ability = {
  id: "commune",
  execute(ctx) {
    const fact = ctx.communeWithDead();
    ctx.sendToActor("communeHint", fact);
    return true;
  },
};
