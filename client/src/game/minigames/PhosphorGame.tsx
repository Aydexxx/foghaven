import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

const TILE_COUNT = 6;
/** How bright a wrong mark can get away with looking, at full health. */
const BASE_DISTRACTOR_MAX = 0.32;
const DISTRACTOR_MIN = 0.12;

interface Tile {
  id: number;
  brightness: number;
  correct: boolean;
}

function buildTiles(handicap: number): Tile[] {
  const correctIndex = Math.floor(Math.random() * TILE_COUNT);
  // Injured: the dim marks read almost as bright as the real one.
  const distractorMax = BASE_DISTRACTOR_MAX + (1 - handicap) * 0.35;
  return Array.from({ length: TILE_COUNT }, (_, i) => ({
    id: i,
    correct: i === correctIndex,
    brightness:
      i === correctIndex ? 1 : DISTRACTOR_MIN + Math.random() * (distractorMax - DISTRACTOR_MIN),
  }));
}

/**
 * Read the Phosphor Chart (8.4, `phosphor`, safe, DARK). One mark on the
 * chart is genuinely phosphorescent; the rest are ordinary ink that only
 * looks faintly luminous once your eyes have adjusted. Tap the one that is
 * actually glowing.
 *
 * One shot, not a countdown: a wrong tap is a wrong reading, not a timeout,
 * so it fails immediately rather than this component inventing its own
 * clock. The server's own deadline (`TASK_BAND_BOUNDS`) is the only clock
 * that matters here.
 */
export function PhosphorGame({ onComplete, onFail, handicap }: MinigameProps) {
  const { t } = useTranslation();
  const tiles = useMemo(() => buildTiles(handicap), [handicap]);

  return (
    <div className="minigame minigame-phosphor" data-minigame="phosphor">
      <p className="minigame-instructions">{t("minigame.phosphor.instructions")}</p>

      <div className="phosphor-chart">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className="phosphor-mark"
            onClick={() => (tile.correct ? onComplete() : onFail())}
            aria-label={t("minigame.phosphor.markLabel")}
          >
            <span className="phosphor-mark-glow" style={{ opacity: tile.brightness }} />
          </button>
        ))}
      </div>
    </div>
  );
}
