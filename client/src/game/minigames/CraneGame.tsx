import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

/** Beam half-length: position runs -100 (left end) to +100 (right end). Reaching either is a drop. */
const BEAM_LIMIT = 100;
/** How hard a held button pushes, in position units/sec². */
const PUSH_ACCEL = 220;
/** Velocity decay per second — without this the load never settles, only oscillates. */
const DAMPING_PER_S = 1.6;
/** Harbour gusts: a slow sinusoidal bias so the beam is never perfectly still. */
const WIND_AMPLITUDE = 60;
const WIND_PERIOD_MS = 2600;
/** |position| below this counts as "balanced" for the stability meter. */
const BALANCED_BAND = 22;
/** How fast the stability meter fills while balanced, and drains while not, in %/sec. */
const STABILITY_FILL_PER_S = 45;
const STABILITY_DRAIN_PER_S = 18;

/**
 * Haul the Crane (8.3, `crane`, **lethal tier**). Keep the swinging load
 * balanced near the beam's centre by holding Left/Right against the harbour
 * wind. Let it reach either end and it drops — `onFail`, and the server's own
 * death path takes it from there (a lethal task's failure is `applyDeath`
 * with no killer, the same corpse a Stranger would leave).
 *
 * The "confirm before it can even start" half of "never a surprise death" is
 * `TaskAttemptOverlay`'s brief screen, not this component — by the time this
 * mounts at all, the player has already been shown the warning and accepted
 * it. This component's only job is to make the danger legible WHILE playing:
 * the beam's danger ends are red from the first frame, the same "telegraph
 * it" principle applied to the moment-to-moment physics rather than the
 * one-time warning.
 *
 * Uses the same Pointer Capture hold-button technique as `GearGame` — two
 * big touch targets, no drag tracking, which is what a balance game needs to
 * stay controllable on a phone.
 */
export function CraneGame({ onComplete, onFail }: MinigameProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState(0);
  const [stability, setStability] = useState(0);
  const [dropped, setDropped] = useState(false);
  const positionRef = useRef(0);
  const velocityRef = useRef(0);
  const stabilityRef = useRef(0);
  const holdingRef = useRef<"left" | "right" | null>(null);
  const resolvedRef = useRef(false);
  const lastTickRef = useRef(performance.now());
  const startRef = useRef(performance.now());
  const frameRef = useRef<number>(0);

  useEffect(() => {
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      if (resolvedRef.current) {
        return;
      }
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      const wind = WIND_AMPLITUDE * Math.sin(((now - startRef.current) / WIND_PERIOD_MS) * Math.PI * 2);
      const push = holdingRef.current === "left" ? -PUSH_ACCEL : holdingRef.current === "right" ? PUSH_ACCEL : 0;
      velocityRef.current += (wind + push) * dt;
      velocityRef.current *= Math.max(0, 1 - DAMPING_PER_S * dt);
      positionRef.current += velocityRef.current * dt;

      if (Math.abs(positionRef.current) >= BEAM_LIMIT) {
        resolvedRef.current = true;
        positionRef.current = Math.sign(positionRef.current) * BEAM_LIMIT;
        setPosition(positionRef.current);
        setDropped(true);
        onFail();
        return;
      }

      const balanced = Math.abs(positionRef.current) <= BALANCED_BAND;
      stabilityRef.current = Math.max(
        0,
        Math.min(
          100,
          stabilityRef.current + (balanced ? STABILITY_FILL_PER_S : -STABILITY_DRAIN_PER_S) * dt,
        ),
      );

      setPosition(positionRef.current);
      setStability(stabilityRef.current);

      if (stabilityRef.current >= 100) {
        resolvedRef.current = true;
        onComplete();
        return;
      }

      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hold = (dir: "left" | "right" | null) => {
    if (!resolvedRef.current) {
      holdingRef.current = dir;
    }
  };

  return (
    <div className="minigame minigame-crane" data-minigame="crane">
      <p className="minigame-instructions">{t("minigame.crane.instructions")}</p>

      <div className={`crane-beam ${dropped ? "crane-beam-dropped" : ""}`}>
        <div className="crane-beam-danger crane-beam-danger-left" />
        <div className="crane-beam-danger crane-beam-danger-right" />
        <div className="crane-beam-band" />
        <div
          className="crane-load"
          style={{ left: `${50 + (position / BEAM_LIMIT) * 50}%` }}
        />
      </div>

      <div className="crane-stability-track">
        <div className="crane-stability-fill" style={{ width: `${stability}%` }} />
      </div>

      <div className="crane-controls">
        <button
          type="button"
          className="crane-button"
          style={{ touchAction: "none" }}
          disabled={resolvedRef.current}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            hold("left");
          }}
          onPointerUp={() => hold(null)}
          onPointerCancel={() => hold(null)}
        >
          {t("minigame.crane.pullLeft")}
        </button>
        <button
          type="button"
          className="crane-button"
          style={{ touchAction: "none" }}
          disabled={resolvedRef.current}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            hold("right");
          }}
          onPointerUp={() => hold(null)}
          onPointerCancel={() => hold(null)}
        >
          {t("minigame.crane.pullRight")}
        </button>
      </div>
    </div>
  );
}
