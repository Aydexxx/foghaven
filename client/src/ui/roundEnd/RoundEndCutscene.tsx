import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { graphicsEngine } from "../../graphics/graphicsEngine";
import {
  isExtinguishedAt,
  roundEndBeatAt,
  roundEndTotalMs,
  type RoundEndBeat,
} from "./roundEndTimeline";

interface RoundEndCutsceneProps {
  /** The losing side's lantern hexes, in roster order — the sequence extinguishes in this order. */
  losingLanternColors: string[];
  /** `gameOver.townsfolkWin` or `gameOver.strangersWin` — the same copy the results screen underneath already shows. */
  titleKey: string;
  /** Called once, the instant the sequence reaches `"done"` — hands off to the real results screen. */
  onComplete: () => void;
}

/**
 * ART_BIBLE §9's round-end row, built as a staged cutscene the way §10's
 * three signature moments are, rather than a state transition: the losing
 * side's lanterns go dark one by one, 80ms apart, and only once the last one
 * is out does the result title slam in.
 *
 * Mounted by `GameOverScreen` in place of its normal content until this
 * calls `onComplete` — see that component's own doc for why a one-shot
 * handoff is safe here (there is no live discussion UI underneath that a
 * `MeetingCallCutscene`-style layered overlay would need to protect
 * continuity for; the results screen behind this one doesn't exist yet).
 *
 * Owns its own clock exactly like `EjectionCutscene`/`MeetingCallCutscene`:
 * one `elapsedMs` measured against `performance.now()` at mount, so the last
 * lantern and the title land at the same wall-clock offset regardless of
 * frame rate.
 */
export function RoundEndCutscene({ losingLanternColors, titleKey, onComplete }: RoundEndCutsceneProps) {
  const { t } = useTranslation();
  const startRef = useRef(performance.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const completedRef = useRef(false);
  const totalMs = roundEndTotalMs(losingLanternColors.length);

  useEffect(() => {
    const interval = setInterval(() => {
      const next = performance.now() - startRef.current;
      setElapsedMs(next);
      if (next >= totalMs) {
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
    // No dependencies beyond mount — `GameOverScreen` mounts this once per
    // results screen and never re-mounts it mid-sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!completedRef.current && elapsedMs >= totalMs) {
      completedRef.current = true;
      onComplete();
    }
  }, [elapsedMs, totalMs, onComplete]);

  const beat: RoundEndBeat = roundEndBeatAt(elapsedMs, losingLanternColors.length);
  const reduced = graphicsEngine.prefersReducedMotion();

  if (beat === "done") {
    return null;
  }

  return (
    <div
      className={`round-end-cutscene${reduced ? " round-end-reduced-motion" : ""}`}
      data-round-end-cutscene
    >
      <div className="round-end-lanterns">
        {losingLanternColors.map((hex, index) => {
          const out = isExtinguishedAt(index, elapsedMs);
          return (
            <span
              key={index}
              className={`round-end-lantern${out ? " round-end-lantern-out" : ""}`}
              style={{ "--round-end-lantern-color": hex } as CSSProperties}
            />
          );
        })}
      </div>

      {beat === "title" && <h1 className="round-end-cutscene-title">{t(titleKey)}</h1>}
    </div>
  );
}
