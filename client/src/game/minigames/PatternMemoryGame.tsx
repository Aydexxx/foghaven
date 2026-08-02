import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";
import { MINIGAME_TILE_COLORS as TILE_COLORS } from "../../theme/minigameTileColors";
const SEQUENCE_LENGTH = 4;
const FLASH_MS = 550;
const GAP_MS = 250;

function randomSequence(length: number, tileCount: number): number[] {
  return Array.from({ length }, () => Math.floor(Math.random() * tileCount));
}

type Phase = "showing" | "input" | "wrong";

/**
 * Watch a sequence of tile flashes, then click the tiles back in the same
 * order. The only mini-game that tests memory rather than a live physical
 * action.
 */
export function PatternMemoryGame({ onComplete, handicap }: MinigameProps) {
  const { t } = useTranslation();
  const sequence = useMemo(() => randomSequence(SEQUENCE_LENGTH, TILE_COLORS.length), []);
  const [phase, setPhase] = useState<Phase>("showing");
  const [litIndex, setLitIndex] = useState<number | null>(null);
  const [inputIndex, setInputIndex] = useState(0);
  // This puzzle's window is how long each tile stays lit — an injured player
  // gets less time to commit the sequence to memory. The sequence itself is
  // untouched: making it longer would change what the task IS, not how hard
  // it is to do while hurt.
  const flashMs = FLASH_MS * handicap;

  useEffect(() => {
    if (phase !== "showing") {
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    sequence.forEach((tile, i) => {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setLitIndex(tile);
          // Floored so a heavy handicap can never invert this into a negative
          // timeout, which would fire immediately and show no flash at all.
          timers.push(
            setTimeout(() => !cancelled && setLitIndex(null), Math.max(60, flashMs - 150)),
          );
        }, i * flashMs),
      );
    });

    timers.push(
      setTimeout(() => {
        if (!cancelled) setPhase("input");
      }, sequence.length * flashMs + GAP_MS),
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [phase, sequence, flashMs]);

  const click = (tile: number) => {
    if (phase !== "input") {
      return;
    }
    if (tile !== sequence[inputIndex]) {
      setPhase("wrong");
      setTimeout(() => {
        setInputIndex(0);
        setPhase("showing");
      }, 700);
      return;
    }

    const next = inputIndex + 1;
    if (next >= sequence.length) {
      onComplete();
    } else {
      setInputIndex(next);
    }
  };

  return (
    <div className="minigame minigame-pattern" data-minigame="pattern">
      <p className="minigame-instructions">
        {phase === "showing"
          ? t("minigame.pattern.watching")
          : phase === "wrong"
            ? t("minigame.pattern.wrong")
            : t("minigame.pattern.yourTurn")}
      </p>

      <div className="pattern-grid">
        {TILE_COLORS.map((color, i) => (
          <button
            key={i}
            type="button"
            data-tile-index={i}
            className={`pattern-tile ${litIndex === i ? "pattern-tile-lit" : ""}`}
            style={{ backgroundColor: color }}
            onClick={() => click(i)}
            disabled={phase !== "input"}
          />
        ))}
      </div>
    </div>
  );
}
