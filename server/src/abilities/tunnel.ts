import { TUNNEL_ENDPOINTS, TUNNEL_USE_RANGE } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The Stranger's cellar tunnel — the "vent equivalent." No client-supplied
 * target: the server checks the actor's own current position against the
 * tunnel's two fixed endpoints (the doors that already bound the walkable
 * Cellar<->Tavern corridor) and teleports to whichever one the actor isn't
 * currently standing at. Standing at neither rejects the attempt for free —
 * no cooldown spent, matching every other ability's "a rejected attempt
 * costs nothing" rule.
 *
 * Never fully invisible: `ctx.teleportActor` broadcasts an audible cue at
 * both endpoints to every connected client, regardless of fog — see its own
 * doc comment.
 */
export const tunnelAbility: Ability = {
  id: "tunnel",
  execute(ctx) {
    const atCellar = ctx.withinRange(ctx.actor, TUNNEL_ENDPOINTS.cellar, TUNNEL_USE_RANGE);
    const atTavern = ctx.withinRange(ctx.actor, TUNNEL_ENDPOINTS.tavern, TUNNEL_USE_RANGE);
    if (!atCellar && !atTavern) {
      return false;
    }

    const destination = atCellar ? TUNNEL_ENDPOINTS.tavern : TUNNEL_ENDPOINTS.cellar;
    const origin = atCellar ? TUNNEL_ENDPOINTS.cellar : TUNNEL_ENDPOINTS.tavern;
    ctx.teleportActor(destination, origin);
    return true;
  },
};
