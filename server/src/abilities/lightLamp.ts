import { LAMP_DURATION_MS } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The lamplighter's signature move: light the lamp, and for
 * `LAMP_DURATION_MS` every living player is visible to every other living
 * player, fog or no fog — see `ctx.litLamp` and the `lampLit` bypass on
 * `GameState`'s `filterChildren`. No target, no range check: this reaches
 * the whole map at once, which is the entire point.
 *
 * Public the moment it fires (`GameState.lampLit` is broadcast state, not a
 * private message) — a lit lamp is a shared, visible event everyone
 * experiences together, not information delivered to one player.
 */
export const lightLampAbility: Ability = {
  id: "light_lamp",
  execute(ctx) {
    ctx.litLamp(LAMP_DURATION_MS);
    return true;
  },
};
