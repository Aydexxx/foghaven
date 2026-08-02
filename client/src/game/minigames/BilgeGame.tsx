import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

/** How fast the water rises, in percentage points per second. */
const RISE_RATE_PCT_PER_S = 13;
/** How much one pump pushes the water back down. */
const PUMP_AMOUNT_PCT = 15;
/** Starting level — not empty, so the first pump matters immediately. */
const START_LEVEL_PCT = 45;

/**
 * Pump the Bilge (8.3, `bilge`, safe). The water rises on its own; tapping
 * the pump pushes it back down. Win by draining it to empty; lose by letting
 * it overflow. The only mini-game whose challenge is sustained real-time
 * pressure rather than a single precise action — and, deliberately, the
 * simplest possible input (one button, no drag, no hold-timing) because that
 * pressure is enough of a challenge on its own, and a single tappable target
 * is the most touch-reliable shape there is.
 */
export function BilgeGame({ onComplete, onFail, handicap }: MinigameProps) {
  const { t } = useTranslation();
  const [level, setLevel] = useState(START_LEVEL_PCT);
  const [pumping, setPumping] = useState(false);
  const levelRef = useRef(START_LEVEL_PCT);
  const resolvedRef = useRef(false);
  const lastTickRef = useRef(performance.now());
  const frameRef = useRef<number>(0);
  // An injured player's pump is weaker, not the water faster — the rising
  // line is the same danger for everyone; what changes is how well you can
  // fight it.
  const pumpAmount = PUMP_AMOUNT_PCT * handicap;

  useEffect(() => {
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      if (!resolvedRef.current) {
        const next = Math.max(0, Math.min(100, levelRef.current + RISE_RATE_PCT_PER_S * dt));
        levelRef.current = next;
        setLevel(next);
        if (next >= 100) {
          resolvedRef.current = true;
          onFail();
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pump = () => {
    if (resolvedRef.current) {
      return;
    }
    const next = Math.max(0, levelRef.current - pumpAmount);
    levelRef.current = next;
    setLevel(next);
    setPumping(true);
    setTimeout(() => setPumping(false), 120);
    if (next <= 0) {
      resolvedRef.current = true;
      onComplete();
    }
  };

  return (
    <div className="minigame minigame-bilge" data-minigame="bilge">
      <p className="minigame-instructions">{t("minigame.bilge.instructions")}</p>

      <div className="bilge-well">
        <div className="bilge-water" style={{ height: `${level}%` }} />
        <div className="bilge-overflow-line" />
      </div>

      <button
        type="button"
        className={`bilge-pump ${pumping ? "bilge-pump-pressed" : ""}`}
        onClick={pump}
        disabled={resolvedRef.current}
      >
        {t("minigame.bilge.pumpLabel")}
      </button>
    </div>
  );
}
