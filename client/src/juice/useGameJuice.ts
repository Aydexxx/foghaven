import { useEffect } from "react";
import type { Room } from "colyseus.js";
import { PHASE } from "@foghaven/shared";
import type { GameState } from "../net/types";
import * as juiceEvents from "./juiceEvents";

/**
 * Room-level §9 effects, wired the same way and for the same reasons as
 * `useGameAudio`: mounted once at the App level for as long as `room` is set,
 * so it keeps listening across every screen the phase moves through rather
 * than being rebuilt on each transition.
 *
 * The split against `GameScene` mirrors the audio one exactly. Anything
 * needing per-frame or per-position data (the body-discovered beat, which has
 * to know whether a sabotage is running) stays in the scene and calls
 * `juiceEvents` directly. Anything that is purely a room event lives here,
 * because it has to fire on screens where the Phaser scene does not exist.
 *
 * A kill is the clearest case: `killed` arrives at the victim, who is by then
 * looking at a death screen rather than the world. Routing it through the
 * scene would mean the one player most entitled to feel the hit is the only
 * one who does not.
 */
export function useGameJuice(room: Room<GameState> | null): void {
  useEffect(() => {
    if (!room) {
      return;
    }

    const offKilled = room.onMessage("killed", () => juiceEvents.kill());
    const offKillConfirmed = room.onMessage("killConfirmed", () => juiceEvents.kill());

    const unlistenPhase = room.state.listen("phase", (phase) => {
      // Every standing effect is world-scoped. Returning to the lobby has to
      // clear them or the vignette and any sabotage pulse persist over the
      // lobby UI for the rest of the session.
      if (phase === PHASE.LOBBY || phase === PHASE.GAME_OVER) {
        juiceEvents.leaveWorld();
      }
    });

    return () => {
      offKilled();
      offKillConfirmed();
      unlistenPhase();
      juiceEvents.leaveWorld();
    };
  }, [room]);
}
