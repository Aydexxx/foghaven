import { cameras, type Ability } from "./types";

/**
 * The watchman's camera. Bugs the room the watchman currently stands in
 * (see the client's `abilityTargetKind: "room"` — there's no separate
 * placement UI, just "press the button while you're there"). From this
 * moment until the next meeting, `GameRoom.update()` logs every living
 * player who passes through that room into the camera's sightings, unless a
 * sabotage is active — see the `blinded` flag. The full list reaches the
 * watchman privately when the meeting starts (`GameRoom.startMeeting`),
 * nobody else.
 *
 * Placing a new camera replaces any the watchman already had this round —
 * one use per round (see the registry), so there is never more than one to
 * track anyway.
 */
export const placeCameraAbility: Ability = {
  id: "place_camera",
  execute(ctx) {
    const { targetRoom } = ctx;
    if (!targetRoom) {
      return false;
    }

    cameras(ctx.roundStore).set(ctx.actorId, {
      roomSlug: targetRoom,
      sightings: new Set<string>(),
      blinded: false,
    });
    return true;
  },
};
