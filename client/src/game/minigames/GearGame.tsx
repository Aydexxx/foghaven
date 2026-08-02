import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

/** Full charge, start to kickback, in ms — a competent player releases well inside 12s of first touching the crank. */
const CHARGE_MS = 1300;
/** Where the safe release window starts, as a % of full charge. */
const SAFE_START_PCT = 58;
/** Width of the safe window, before `handicap` narrows it. */
const SAFE_WIDTH_PCT = 16;

/**
 * Wind the Lighthouse Gear (8.3, `gear`, **injury tier**). Hold to wind the
 * spring, release inside the highlighted band. Release early and nothing is
 * lost — the spring just relaxes, try again. Release late, past the band's
 * far edge, and the crank kicks back: `onFail`.
 *
 * "Show the danger zone on the gauge before they start" — the band and the
 * red kickback zone past it are both drawn from the first frame, not
 * revealed only once the player is already charging.
 *
 * Built on Pointer Capture rather than the window-listener drag pattern the
 * other games use: this is a press-and-HOLD, not a drag toward a target, so
 * the interaction only needs one element to keep receiving events even if a
 * touch drifts slightly — exactly what `setPointerCapture` is for, and it
 * needs no cross-window listener at all.
 */
export function GearGame({ onComplete, onFail, handicap }: MinigameProps) {
  const { t } = useTranslation();
  // A narrower window is the injury handicap's whole effect here — the
  // charge rate and the kickback zone are untouched, so an injured player
  // faces the exact same crank, just less room for error.
  const safeWidth = SAFE_WIDTH_PCT * handicap;
  const safeStart = SAFE_START_PCT;
  const safeEnd = safeStart + safeWidth;

  const [charge, setCharge] = useState(0);
  const [holding, setHolding] = useState(false);
  const [kicked, setKicked] = useState(false);
  const startRef = useRef(0);
  const frameRef = useRef<number>(0);
  const chargeRef = useRef(0);
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (!holding) {
      return;
    }
    startRef.current = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(100, ((now - startRef.current) / CHARGE_MS) * 100);
      chargeRef.current = pct;
      setCharge(pct);
      if (pct >= 100 && !resolvedRef.current) {
        // Held all the way to the top without releasing — the spring winds
        // itself past the crank's limit exactly as a late release would.
        resolvedRef.current = true;
        setKicked(true);
        setHolding(false);
        onFail();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [holding, onFail]);

  const release = () => {
    if (!holding || resolvedRef.current) {
      return;
    }
    setHolding(false);
    const pct = chargeRef.current;
    if (pct < safeStart) {
      // Under-wound: harmless, just start again.
      setCharge(0);
      chargeRef.current = 0;
      return;
    }
    resolvedRef.current = true;
    if (pct <= safeEnd) {
      onComplete();
      return;
    }
    setKicked(true);
    onFail();
  };

  return (
    <div className="minigame minigame-gear" data-minigame="gear">
      <p className="minigame-instructions">{t("minigame.gear.instructions")}</p>

      <div className={`gear-gauge ${kicked ? "gear-gauge-kicked" : ""}`}>
        <div className="gear-gauge-track">
          <div className="gear-gauge-safe" style={{ left: `${safeStart}%`, width: `${safeWidth}%` }} />
          <div className="gear-gauge-danger" style={{ left: `${safeEnd}%`, width: `${100 - safeEnd}%` }} />
          <div className="gear-gauge-fill" style={{ width: `${charge}%` }} />
        </div>
      </div>

      <button
        type="button"
        className={`gear-crank ${holding ? "gear-crank-winding" : ""} ${kicked ? "gear-crank-kicked" : ""}`}
        style={{ touchAction: "none" }}
        disabled={resolvedRef.current}
        onPointerDown={(e) => {
          if (resolvedRef.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setKicked(false);
          setHolding(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {t("minigame.gear.crankLabel")}
      </button>
    </div>
  );
}
