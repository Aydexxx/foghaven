import { useEffect, useRef } from "react";
import type { Room } from "colyseus.js";
import { PHASE, MEETING_STAGE, roleById } from "@foghaven/shared";
import type { GameState } from "../net/types";
import { audioEngine } from "./audioEngine";

/**
 * Wires room-level events to the audio engine: the stingers that aren't
 * tied to a specific position (meeting start, ejection, sabotage, win/loss,
 * a kill from either side of it) and the tension score behind the adaptive
 * music. Mounted once at the App level for as long as `room` is set, so it
 * keeps listening across every screen the phase moves through rather than
 * being torn down and rebuilt on each transition.
 *
 * Room-based ambience and footstep spatial audio are deliberately *not*
 * here — those need per-frame position data that only exists inside
 * `GameScene`, which calls into `audioEngine` directly.
 *
 * The one rule everything below has to obey: tension (and every stinger
 * trigger) may only react to information this player would actually have.
 * `deadPlayerIds` is safe for exactly the reason the schema documents it as
 * public — it only ever holds *discovered* deaths — but a raw count of
 * `!player.alive` across `state.players` would not be: a living client's
 * copy of another living player never learns of their death at all (see
 * `GameState`'s fog filter), so it would either undercount by luck or, worse,
 * be wrong in a way nothing else in the UI is. Tension is just another
 * output channel, and it gets the same no-leak discipline the fog and the
 * position sync already apply everywhere else.
 */
export function useGameAudio(room: Room<GameState> | null, localRole: string | null): void {
  // Read inside listeners without re-subscribing every time the role or
  // room reference itself is the only thing that changed shape.
  const roleRef = useRef(localRole);
  roleRef.current = localRole;

  useEffect(() => {
    if (!room) {
      return;
    }

    const recomputeTension = () => {
      const state = room.state;
      const total = Math.max(1, state.players.size);
      const deathRatio = state.deadPlayerIds.length / total;
      const taskRelief =
        state.taskBarTotal > 0 ? state.taskBarCompleted / state.taskBarTotal : 0;
      const meetingBump = state.phase === PHASE.MEETING ? 0.15 : 0;
      const tension = deathRatio * 0.8 + meetingBump - taskRelief * 0.15;
      audioEngine.setTension(tension);
    };

    const unlistenPhase = room.state.listen("phase", (phase, previous) => {
      if (phase === PHASE.MEETING && previous !== PHASE.MEETING) {
        audioEngine.playStinger("meetingStart");
      }
      if (phase === PHASE.GAME_OVER) {
        // Compare FACTIONS, not the raw role id — a doctor is townsfolk and
        // must hear the town's win sting, not a loss.
        const faction = roleRef.current ? roleById(roleRef.current)?.faction : undefined;
        const won = faction !== undefined && room.state.winningFaction === faction;
        audioEngine.playStinger(won ? "win" : "loss");
      }
      if (phase === PHASE.LOBBY) {
        audioEngine.reset();
      }
      recomputeTension();
    });

    const unlistenStage = room.state.listen("meetingStage", (stage) => {
      // The reveal itself, not the ballot closing — `ejectedPlayerId` is
      // already set by the time RESULTS is entered (see `GameRoom.resolveVotes`).
      if (stage === MEETING_STAGE.RESULTS && room.state.ejectedPlayerId) {
        audioEngine.playStinger("ejection");
      }
    });

    const unlistenSabotage = room.state.listen("sabotageActive", (active) => {
      audioEngine.setSabotageActive(active);
      if (active) {
        audioEngine.playStinger("sabotageAlarm");
      }
    });

    const offKilled = room.onMessage("killed", () => audioEngine.playStinger("kill"));
    const offKillConfirmed = room.onMessage("killConfirmed", () =>
      audioEngine.playStinger("kill"),
    );

    room.onStateChange(recomputeTension);
    recomputeTension();

    return () => {
      unlistenPhase();
      unlistenStage();
      unlistenSabotage();
      offKilled();
      offKillConfirmed();
      room.onStateChange.remove(recomputeTension);
    };
  }, [room]);
}
