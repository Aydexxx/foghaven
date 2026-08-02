import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

/** Minimum time, in ms, a full wipe from empty to developed must take — faster than this overexposes the plate. */
const MIN_DEVELOP_MS = 900;
/** Position, as a % of the tray's width, that counts as "reached the far edge." */
const DONE_PCT = 98;

/**
 * Develop the Plate (8.4, `plate`, safe, DARK). Drag the wiper from the left
 * edge of the tray to the right in one unhurried pass; the photograph beneath
 * it is revealed as the wiper crosses it. Reach the far edge too quickly and
 * the plate overexposes — `onFail`. Letting go partway through costs nothing
 * but the wipe: the wiper snaps back to the start and the next pointerdown
 * begins a fresh, freshly-timed pass.
 *
 * Timed rather than zoned like `WickGame` — there is no band to land in here,
 * only a pace not to rush past — which is what makes the one failure state
 * about impatience rather than precision.
 */
export function PlateGame({ onComplete, onFail, handicap }: MinigameProps) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [ruined, setRuined] = useState(false);
  const positionRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const resolvedRef = useRef(false);
  // An injured player has to go even slower to stay safe — the floor moves
  // up, not the tray.
  const minDevelopMs = MIN_DEVELOP_MS / handicap;

  const pctFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return positionRef.current;
    const rect = track.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (e: PointerEvent) => {
      if (resolvedRef.current) return;
      const next = pctFromClientX(e.clientX);
      positionRef.current = next;
      setPosition(next);
      if (next >= DONE_PCT && startedAtRef.current !== null) {
        const elapsed = performance.now() - startedAtRef.current;
        resolvedRef.current = true;
        setDragging(false);
        if (elapsed < minDevelopMs) {
          setRuined(true);
          onFail();
        } else {
          onComplete();
        }
      }
    };
    const onUp = () => {
      setDragging(false);
      if (resolvedRef.current) {
        return;
      }
      // Let go partway through: back to the start, next pass timed fresh.
      positionRef.current = 0;
      setPosition(0);
      startedAtRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  return (
    <div className="minigame minigame-plate" data-minigame="plate">
      <p className="minigame-instructions">{t("minigame.plate.instructions")}</p>

      <div
        ref={trackRef}
        className={`plate-tray ${ruined ? "plate-tray-ruined" : ""}`}
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          if (resolvedRef.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          if (positionRef.current === 0) {
            startedAtRef.current = performance.now();
          }
          setDragging(true);
        }}
      >
        <div className="plate-image" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} />
        <div
          className={`plate-wiper ${dragging ? "plate-wiper-active" : ""}`}
          style={{ left: `${position}%` }}
        />
      </div>
    </div>
  );
}
