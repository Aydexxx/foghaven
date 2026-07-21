import { DOOR_LOCK_DURATION_MS } from "@foghaven/shared";
import type { Ability } from "./types";

/**
 * The Saboteur's door lock. Bugs — sorry, locks — the room the Saboteur
 * currently stands in (same "press the button while you're there" pattern
 * as the watchman's `place_camera`; see `ctx.targetRoom`'s validation
 * against the same real-room allowlist). Physically blocks movement through
 * that room's doors for `DOOR_LOCK_DURATION_MS` — see
 * `applyInputWithLocks` in `shared/game/movement.ts`, which both client
 * prediction and server simulation consult identically.
 *
 * Self-gated on `criticalSabotageActive`: no other sabotage fires while a
 * critical failure has the town's full attention.
 */
export const lockDoorAbility: Ability = {
  id: "lock_door",
  execute(ctx) {
    if (ctx.criticalSabotageActive) {
      return false;
    }
    const { targetRoom } = ctx;
    if (!targetRoom) {
      return false;
    }
    ctx.lockDoor(targetRoom, DOOR_LOCK_DURATION_MS);
    return true;
  },
};
