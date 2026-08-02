import { useEffect, useRef } from "react";
import type { Room } from "colyseus.js";
import { PHASE, roleById, type TaskOutcomeMessage } from "@foghaven/shared";
import type { GameState } from "../net/types";
import { audioEngine } from "./audioEngine";

/**
 * Wires room-level events to the audio engine: the stingers that aren't tied
 * to a specific position or a timed cutscene beat (sabotage, win/loss, a kill
 * from either side of it). Mounted once at the App level for as long as
 * `room` is set, so it keeps listening across every screen the phase moves
 * through rather than being torn down and rebuilt on each transition.
 *
 * Room-based ambience and footstep spatial audio are deliberately *not*
 * here — those need per-frame position data that only exists inside
 * `GameScene`, which calls into `audioEngine` directly.
 *
 * The ejection's two stingers (the whoosh, the bell toll) are ALSO
 * deliberately not here, even though "ejection" used to fire from this file
 * the instant `meetingStage` reached RESULTS — §10.2's cutscene now owns
 * both, firing each at its own beat's start from inside `EjectionCutscene`,
 * because the whole point of a timed sequence is that its audio lands on
 * specific beats, not at the instant the stage changes. `EjectionCutscene` is
 * mounted as part of `MeetingScreen`, which is never unmounted during a
 * meeting (see `App`'s "rendered over, never instead of" comment on
 * `ReconnectOverlay`), so moving the trigger there loses no coverage.
 *
 * For the same reason, `meetingStart` (the bell swell) and the meeting call's
 * own bell toll are gone from here too — §10.3's `MeetingCallCutscene` now
 * fires both, at its ring-flare and bell beats respectively. It is mounted by
 * `MeetingScreen` whenever a meeting is entering (or resuming mid-)
 * DISCUSSION, which is exactly the condition this file's old `phase`
 * listener was approximating with "did phase just become MEETING" — a
 * `state.listen` callback only fires on a transition observed AFTER it
 * attaches, so a reconnecting client was never getting this sting for a
 * meeting already past DISCUSSION either; coverage is unchanged, not reduced.
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

    const unlistenPhase = room.state.listen("phase", (phase) => {
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
    });

    const unlistenSabotage = room.state.listen("sabotageActive", (active) => {
      if (active) {
        audioEngine.playStinger("sabotageAlarm");
      }
    });

    const offKilled = room.onMessage("killed", () => audioEngine.playStinger("kill"));
    const offKillConfirmed = room.onMessage("killConfirmed", () =>
      audioEngine.playStinger("kill"),
    );

    // §8.3's two new stingers. A lethal failure needs no branch here at all —
    // `applyDeath` sends the same `"killed"` message a murder does, so
    // `offKilled` above already covers it, and covering it a second time here
    // would be the two-writers-to-one-signal bug this file's own doc warns
    // against for `ejection`/`meetingStart`.
    const offTaskOutcome = room.onMessage<TaskOutcomeMessage>("taskOutcome", (msg) => {
      if (msg.success) {
        audioEngine.playStinger("taskComplete");
      } else if (msg.tier === "injury") {
        audioEngine.playStinger("taskInjury");
      }
    });

    return () => {
      unlistenPhase();
      unlistenSabotage();
      offKilled();
      offKillConfirmed();
      offTaskOutcome();
    };
  }, [room]);
}
