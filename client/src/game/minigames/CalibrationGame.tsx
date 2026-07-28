import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { duration } from "../../theme/tokens";
import type { MinigameProps } from "./types";

/** Full sweep of the indicator, in milliseconds (there and back). */
const SWEEP_MS = 1400;
/** Width of the success zone, as a percentage of the track. */
const ZONE_WIDTH_PCT = 18;

/** A random zone that leaves the indicator room to sweep across the whole track. */
function randomZone(): { start: number; width: number } {
  const width = ZONE_WIDTH_PCT;
  const start = Math.random() * (100 - width);
  return { start, width };
}

/**
 * A bar sweeps back and forth on its own; the player has to hit Stop while the
 * indicator sits inside the highlighted zone. Timing-based, unlike anything
 * else in the mini-game set.
 */
export function CalibrationGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const zone = useMemo(() => randomZone(), []);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(0);
  const frameRef = useRef<number>(0);
  const startRef = useRef(performance.now());
  const [miss, setMiss] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const tick = (now: number) => {
      const elapsed = (now - startRef.current) % SWEEP_MS;
      const half = SWEEP_MS / 2;
      // Triangle wave 0 -> 100 -> 0, so the sweep reverses smoothly at each end.
      const pct = elapsed < half ? (elapsed / half) * 100 : 100 - ((elapsed - half) / half) * 100;
      positionRef.current = pct;
      if (indicatorRef.current) {
        indicatorRef.current.style.left = `${pct}%`;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  const stop = () => {
    if (locked) {
      return;
    }
    const pos = positionRef.current;
    if (pos >= zone.start && pos <= zone.start + zone.width) {
      setLocked(true);
      cancelAnimationFrame(frameRef.current);
      setTimeout(onComplete, duration.slow);
    } else {
      setMiss(true);
      setTimeout(() => setMiss(false), duration.slow);
    }
  };

  return (
    <div className="minigame minigame-calibration" data-minigame="calibration">
      <p className="minigame-instructions">{t("minigame.calibration.instructions")}</p>

      <div className={`calibration-track ${miss ? "calibration-track-miss" : ""}`}>
        <div
          className="calibration-zone"
          style={{ left: `${zone.start}%`, width: `${zone.width}%` }}
        />
        <div
          ref={indicatorRef}
          className={`calibration-indicator ${locked ? "calibration-indicator-locked" : ""}`}
        />
      </div>

      <button type="button" className="calibration-stop" onClick={stop} disabled={locked}>
        {t("minigame.calibration.stopButton")}
      </button>
    </div>
  );
}
