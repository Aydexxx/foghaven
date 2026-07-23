import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { ClientTask, MinigameType } from "@foghaven/shared";
import type { MinigameProps } from "../game/minigames/types";

// Lazy so none of the six mini-games' code ships in the initial bundle —
// only one is ever shown at a time, and a given session may never open some
// of them at all. Each becomes its own chunk, fetched the first time a task
// of that type is opened.
const MINIGAMES: Record<MinigameType, ComponentType<MinigameProps>> = {
  wires: lazy(() => import("../game/minigames/WireConnectingGame").then((m) => ({ default: m.WireConnectingGame }))),
  code: lazy(() => import("../game/minigames/CodeEntryGame").then((m) => ({ default: m.CodeEntryGame }))),
  calibration: lazy(() => import("../game/minigames/CalibrationGame").then((m) => ({ default: m.CalibrationGame }))),
  pattern: lazy(() => import("../game/minigames/PatternMemoryGame").then((m) => ({ default: m.PatternMemoryGame }))),
  ordering: lazy(() => import("../game/minigames/OrderingGame").then((m) => ({ default: m.OrderingGame }))),
  rotation: lazy(() => import("../game/minigames/RotationGame").then((m) => ({ default: m.RotationGame }))),
};

interface MinigameModalProps {
  task: ClientTask;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Picks the right mini-game component for the task at hand and renders it
 * inside a shared modal chrome. Every mini-game gets the exact same two
 * callbacks — see `MinigameProps` — so this component never needs to know
 * how any individual puzzle works.
 */
export function MinigameModal({ task, onComplete, onCancel }: MinigameModalProps) {
  const { t } = useTranslation();
  const Minigame = MINIGAMES[task.minigame];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="minigame-overlay">
      <div className="minigame-panel" role="dialog" aria-modal="true" aria-label={task.room}>
        <header className="minigame-panel-header">
          <span>{task.room}</span>
          <button
            type="button"
            className="minigame-panel-close"
            onClick={onCancel}
            aria-label={t("minigame.cancel")}
          >
            ✕
          </button>
        </header>
        <Suspense fallback={<p className="minigame-instructions">{t("app.loading")}</p>}>
          <Minigame onComplete={onComplete} onCancel={onCancel} />
        </Suspense>
      </div>
    </div>
  );
}
