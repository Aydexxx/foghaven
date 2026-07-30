import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { audioEngine } from "../../audio/audioEngine";
import { graphicsEngine } from "../../graphics/graphicsEngine";
import {
  EJECTION_BEAT_START,
  EJECTION_CUTSCENE_TOTAL_MS,
  EJECTION_SKIP_ELIGIBLE_MS,
  ejectionBackdropUrl,
  ejectionBeatAt,
  ejectionRevealKeys,
  type EjectionBeat,
} from "./ejectionTimeline";

interface EjectionCutsceneProps {
  name: string;
  /** Whether the "reveal ejected player's faction" lobby setting is on — see `resolveVotes` in `GameRoom.ts`. */
  ejectionConfirmed: boolean;
  ejectedWasStranger: boolean;
}

/**
 * ART_BIBLE §10.2, "the shot that goes on the store page": a side-on pier at
 * night, the ejected Havener walking away into the fog, the lantern
 * shrinking, going still, going dark on one bell toll, then the reveal text —
 * which is also where the sequence rests once it's done. Mounted by
 * `MeetingScreen` for the whole RESULTS stage whenever someone was actually
 * ejected; it owns its own clock end to end and reads no server timer.
 *
 * ## Why one timeline, not five separately-triggered effects
 *
 * Everything here — beat transitions, the two stingers, the skip gate — is
 * driven off ONE `elapsedMs` measured against `performance.now()` at mount,
 * recomputed on a single interval. That is what makes the reveal beat land at
 * the same wall-clock offset regardless of frame rate, and it is what makes
 * skip trivial to implement correctly: skipping is nothing but jumping
 * `elapsedMs` straight to `EJECTION_CUTSCENE_TOTAL_MS`, which the existing
 * beat-resolution logic (`ejectionBeatAt`) already treats as "reveal, and
 * stay there" — the terminal state and the skip target are the same code
 * path, not two.
 *
 * ## Per-client, not shared
 *
 * Nothing in this component talks to the server — no `room.send`, no read of
 * any per-client server timer. `stageStartedAt` from `MeetingScreen` (via this
 * component's `key`) is the only server-derived input, and it is the same
 * value every client in the meeting already has. Skipping only ever sets
 * local component state, so one player mashing a key to skip is invisible to
 * everyone else's screen and changes nothing about how long the results
 * PHASE itself runs (`RESULTS_MS`, server-owned, unaffected either way).
 */
export function EjectionCutscene({
  name,
  ejectionConfirmed,
  ejectedWasStranger,
}: EjectionCutsceneProps) {
  const { t } = useTranslation();
  const startRef = useRef(performance.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const playedBellRef = useRef(false);
  // Set the instant a skip fires. The interval effect below checks this
  // BEFORE trusting the real clock — without that guard, the next 50ms tick
  // would overwrite the skip-to-the-end with the real (still mid-sequence)
  // elapsed time, un-skipping it a moment after the player skipped.
  const skippedRef = useRef(false);

  useEffect(() => {
    // The walk beat's own stinger — see `stingers.ts`, "a falling filtered
    // sweep into a thud, motion not a hit". Fired once, at mount, which is
    // exactly beat 1's start.
    audioEngine.playStinger("ejection");

    const interval = setInterval(() => {
      if (skippedRef.current) {
        return;
      }
      const next = performance.now() - startRef.current;
      setElapsedMs(next);
      // Once settled into the terminal reveal state there is nothing left to
      // advance — stop ticking rather than re-rendering for the remainder of
      // the results stage (up to a few more seconds) for no visible effect.
      if (next >= EJECTION_CUTSCENE_TOTAL_MS) {
        clearInterval(interval);
      }
    }, 50);

    // "Add a skip on any input after 1.5s." Purely local: this only ever
    // moves this client's own `elapsedMs` forward, never sends anything, so
    // one player skipping is invisible to every other client in the meeting.
    const trySkip = () => {
      if (
        !skippedRef.current &&
        performance.now() - startRef.current >= EJECTION_SKIP_ELIGIBLE_MS
      ) {
        skippedRef.current = true;
        setElapsedMs(EJECTION_CUTSCENE_TOTAL_MS);
      }
    };
    window.addEventListener("keydown", trySkip);
    window.addEventListener("pointerdown", trySkip);

    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", trySkip);
      window.removeEventListener("pointerdown", trySkip);
    };
    // No dependencies beyond mount: this effect's whole job is "run once for
    // this cutscene's lifetime", and `MeetingScreen` already remounts this
    // component (via `key`) for every new results stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beat: EjectionBeat = ejectionBeatAt(elapsedMs);

  // The bell toll fires exactly once, the instant elapsed time crosses into
  // the "bell" beat — a `ref` guard rather than a beat-change effect because
  // skipping can jump straight past "bell" into "reveal" in one state update,
  // and the toll must still have played by then (§10.2: "the light goes out,
  // one bell toll", not "...if you happened to be there for the transition").
  useEffect(() => {
    if (!playedBellRef.current && elapsedMs >= EJECTION_BEAT_START.bell) {
      playedBellRef.current = true;
      audioEngine.playStinger("bellToll");
    }
  }, [elapsedMs]);

  const reduced = graphicsEngine.prefersReducedMotion();
  const { line1Key, line2Key } = ejectionRevealKeys(ejectionConfirmed, ejectedWasStranger);
  const canSkip = elapsedMs >= EJECTION_SKIP_ELIGIBLE_MS;

  return (
    <div
      className={`ejection-cutscene ejection-beat-${beat}${reduced ? " ejection-reduced-motion" : ""}`}
      data-ejection-cutscene
      // A custom property, not `backgroundImage` directly — the CSS rule
      // layers this UNDER a procedural gradient (`.ejection-cutscene`'s own
      // `background-image`), so a 404 on the real art (there is none yet)
      // leaves the gradient placeholder showing rather than a blank panel.
      // Setting `backgroundImage` inline here would replace that layered
      // rule outright instead of feeding into it.
      style={{ "--ejection-backdrop-url": `url(${ejectionBackdropUrl()})` } as CSSProperties}
    >
      <div className="ejection-backdrop-placeholder" />
      <div className="ejection-figure">
        <span className="ejection-lantern" />
      </div>

      {beat === "reveal" && (
        <div className="ejection-reveal-text">
          <p>{t(line1Key, { name })}</p>
          {line2Key && <p>{t(line2Key)}</p>}
        </div>
      )}

      {canSkip && beat !== "reveal" && (
        <p className="ejection-skip-hint">{t("meeting.ejection.skipHint")}</p>
      )}
    </div>
  );
}
