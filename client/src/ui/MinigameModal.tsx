import { useEffect, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { ClientTask, MinigameType } from "@foghaven/shared";
import type { MinigameProps } from "../game/minigames/types";
import { WireConnectingGame } from "../game/minigames/WireConnectingGame";
import { CodeEntryGame } from "../game/minigames/CodeEntryGame";
import { CalibrationGame } from "../game/minigames/CalibrationGame";
import { PatternMemoryGame } from "../game/minigames/PatternMemoryGame";
import { OrderingGame } from "../game/minigames/OrderingGame";
import { RotationGame } from "../game/minigames/RotationGame";

const MINIGAMES: Record<MinigameType, ComponentType<MinigameProps>> = {
  wires: WireConnectingGame,
  code: CodeEntryGame,
  calibration: CalibrationGame,
  pattern: PatternMemoryGame,
  ordering: OrderingGame,
  rotation: RotationGame,
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
        <Minigame onComplete={onComplete} onCancel={onCancel} />
      </div>
    </div>
  );
}
