import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

/** Percentage points of the track the target band spans, before `handicap`. */
const ZONE_WIDTH_PCT = 16;
/** How far up the track the band's centre can land — keeps it off both edges. */
const ZONE_CENTER_MIN = 35;
const ZONE_CENTER_MAX = 75;

function randomZone(handicap: number): { start: number; width: number } {
  const width = ZONE_WIDTH_PCT * handicap;
  const center = ZONE_CENTER_MIN + Math.random() * (ZONE_CENTER_MAX - ZONE_CENTER_MIN);
  return { start: center - width / 2, width };
}

/**
 * Trim the Wick (8.3, `wick`, safe). Drag the flame height up the gauge into
 * the highlighted band and let go there. Push past the band's top edge and
 * the wick gutters out — height snaps back to zero, no penalty beyond
 * starting over. There is no `onFail` here on purpose: an overshoot is a
 * reset, not a loss, exactly as the roadmap specifies ("Overshoot just
 * resets").
 *
 * Built as a direct vertical drag rather than `RotationGame`'s old
 * click-to-step dial: continuous control is what makes "overshoot" a thing
 * that can happen at all, and it is what makes this feel different from
 * every click-based puzzle in the set.
 */
export function WickGame({ onComplete, handicap }: MinigameProps) {
  const { t } = useTranslation();
  const zone = useRef(randomZone(handicap)).current;
  const trackRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [guttered, setGuttered] = useState(false);
  // Mirrors `height` synchronously, so the pointerup handler (registered once
  // per drag, not once per move) always reads the latest value rather than a
  // stale one closed over at drag start.
  const heightRef = useRef(0);

  const heightFromClientY = (clientY: number): number => {
    const track = trackRef.current;
    if (!track) return heightRef.current;
    const rect = track.getBoundingClientRect();
    const pct = ((rect.bottom - clientY) / rect.height) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (e: PointerEvent) => {
      const next = heightFromClientY(e.clientY);
      if (next > zone.start + zone.width) {
        // Overshoot: gutter out and reset, exactly as the room's own flame would.
        setGuttered(true);
        heightRef.current = 0;
        setHeight(0);
        setTimeout(() => setGuttered(false), 260);
        return;
      }
      heightRef.current = next;
      setHeight(next);
    };
    const onUp = () => {
      setDragging(false);
      if (heightRef.current >= zone.start && heightRef.current <= zone.start + zone.width) {
        onComplete();
      }
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
    <div className="minigame minigame-wick" data-minigame="wick">
      <p className="minigame-instructions">{t("minigame.wick.instructions")}</p>

      <div
        ref={trackRef}
        className={`wick-track ${guttered ? "wick-track-gutter" : ""}`}
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const next = heightFromClientY(e.clientY);
          heightRef.current = next;
          setHeight(next);
          setDragging(true);
        }}
      >
        <div
          className="wick-zone"
          style={{ height: `${zone.width}%`, bottom: `${zone.start}%` }}
        />
        <div className="wick-flame" style={{ height: `${height}%` }} />
        <div
          className={`wick-handle ${dragging ? "wick-handle-active" : ""}`}
          style={{ bottom: `${height}%` }}
        />
      </div>
    </div>
  );
}
