import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

/** One full sweep from one edge to the other, in ms. */
const SWEEP_MS = 1500;
/** Width of the aligned band, as a % of the track, before `handicap` narrows it. */
const ZONE_WIDTH_PCT = 22;
const ZONE_CENTER_PCT = 50;
const SUCCESS_TARGET = 3;
const MAX_MISSES = 3;

/**
 * Set the Signal Mirror (8.4, `mirror`, safe, DARK). The beam sweeps the
 * gauge on its own — back and forth, on a fixed rhythm no input changes. Tap
 * "Catch" the moment it sits inside the band; three good catches finishes
 * it, three bad ones and you've flashed the wrong signal — `onFail`.
 *
 * The one mini-game of the eight where the player controls no motion at all,
 * only timing: the beam belongs to the lighthouse, not to them, which is the
 * whole point of a task about catching someone else's light rather than
 * making your own.
 */
export function MirrorGame({ onComplete, onFail, handicap }: MinigameProps) {
  const { t } = useTranslation();
  const zoneWidth = ZONE_WIDTH_PCT * handicap;
  const zoneStart = ZONE_CENTER_PCT - zoneWidth / 2;
  const zoneEnd = ZONE_CENTER_PCT + zoneWidth / 2;

  const [beamPct, setBeamPct] = useState(0);
  const [successes, setSuccesses] = useState(0);
  const [misses, setMisses] = useState(0);
  const [flash, setFlash] = useState<"hit" | "miss" | null>(null);
  const beamRef = useRef(0);
  const frameRef = useRef<number>(0);
  const resolvedRef = useRef(false);

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) % (SWEEP_MS * 2);
      const pct =
        elapsed <= SWEEP_MS
          ? (elapsed / SWEEP_MS) * 100
          : 100 - ((elapsed - SWEEP_MS) / SWEEP_MS) * 100;
      beamRef.current = pct;
      setBeamPct(pct);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  const catchBeam = () => {
    if (resolvedRef.current) {
      return;
    }
    const inZone = beamRef.current >= zoneStart && beamRef.current <= zoneEnd;
    if (inZone) {
      setFlash("hit");
      const next = successes + 1;
      setSuccesses(next);
      if (next >= SUCCESS_TARGET) {
        resolvedRef.current = true;
        onComplete();
      }
    } else {
      setFlash("miss");
      const next = misses + 1;
      setMisses(next);
      if (next >= MAX_MISSES) {
        resolvedRef.current = true;
        onFail();
      }
    }
    setTimeout(() => setFlash(null), 180);
  };

  return (
    <div className="minigame minigame-mirror" data-minigame="mirror">
      <p className="minigame-instructions">{t("minigame.mirror.instructions")}</p>

      <div className="mirror-gauge">
        <div className="mirror-gauge-track">
          <div
            className="mirror-gauge-zone"
            style={{ left: `${zoneStart}%`, width: `${zoneWidth}%` }}
          />
          <div className="mirror-gauge-beam" style={{ left: `${beamPct}%` }} />
        </div>
      </div>

      <p className="mirror-progress">
        {t("minigame.mirror.progress", { successes, target: SUCCESS_TARGET })}
      </p>

      <button
        type="button"
        className={`mirror-catch ${flash ? `mirror-catch-${flash}` : ""}`}
        disabled={resolvedRef.current}
        onClick={catchBeam}
      >
        {t("minigame.mirror.catchLabel")}
      </button>
    </div>
  );
}
