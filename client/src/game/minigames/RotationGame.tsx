import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { duration } from "../../theme/tokens";
import type { MinigameProps } from "./types";

const DIAL_COUNT = 3;
const STEP_DEG = 45;
const POSITIONS = 360 / STEP_DEG;

/** A non-zero target so every dial needs at least one click to align. */
function randomTarget(): number {
  const steps = 1 + Math.floor(Math.random() * (POSITIONS - 1));
  return steps * STEP_DEG;
}

/**
 * Click each dial to rotate it 45° at a time until it lines up with its
 * (randomised) target angle. All three aligned at once finishes the task —
 * a spatial puzzle, unlike anything click-to-match or drag-based here.
 */
export function RotationGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const targets = useMemo(() => Array.from({ length: DIAL_COUNT }, randomTarget), []);
  const [rotations, setRotations] = useState<number[]>(() => Array(DIAL_COUNT).fill(0));

  const rotate = (index: number) => {
    setRotations((prev) => {
      const next = [...prev];
      next[index] = (next[index]! + STEP_DEG) % 360;

      if (next.every((deg, i) => deg === targets[i])) {
        setTimeout(onComplete, duration.slow);
      }
      return next;
    });
  };

  return (
    <div className="minigame minigame-rotation" data-minigame="rotation">
      <p className="minigame-instructions">{t("minigame.rotation.instructions")}</p>

      <div className="rotation-dials">
        {rotations.map((deg, i) => {
          const aligned = deg === targets[i];
          return (
            <button
              key={i}
              type="button"
              className={`rotation-dial ${aligned ? "rotation-dial-aligned" : ""}`}
              onClick={() => rotate(i)}
              disabled={aligned}
              aria-label={t("minigame.rotation.dialLabel", { index: i + 1 })}
            >
              <span className="rotation-target" style={{ transform: `rotate(${targets[i]}deg)` }} />
              <span className="rotation-needle" style={{ transform: `rotate(${deg}deg)` }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
