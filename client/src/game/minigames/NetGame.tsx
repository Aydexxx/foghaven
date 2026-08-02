import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";
import { MINIGAME_TILE_COLORS as PALETTE } from "../../theme/minigameTileColors";

const BOARD_WIDTH = 300;
const BOARD_HEIGHT = 200;
const ROPE_X = 30;
const KNOT_X = BOARD_WIDTH - 30;

function slotY(index: number, count: number): number {
  return 30 + index * ((BOARD_HEIGHT - 60) / (count - 1));
}

function shuffledPalette(): string[] {
  const colors = [...PALETTE];
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j]!, colors[i]!];
  }
  return colors.every((c, i) => c === PALETTE[i]) ? shuffledPalette() : colors;
}

interface Drag {
  color: string;
  x: number;
  y: number;
}

/**
 * Mend the Net (8.3, `net`, safe). Drag each loose rope end to its matching
 * knot. Mechanically identical to the old `WireConnectingGame` — live pointer
 * dragging between two distinct points is exactly the right shape for
 * "reconnect these frayed ends" — but re-skinned as rope, not wire, and with
 * `touchAction: "none"` added on the drag handles, which the version this
 * replaces was missing (see the 8.3 prompt's own warning: "drag-based
 * mini-games tend to work on desktop and fall apart on touch").
 *
 * No `onFail`: a net has no way to be mended wrong, only slowly.
 */
export function NetGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const knotOrder = useMemo(shuffledPalette, []);
  const boardRef = useRef<HTMLDivElement>(null);
  const [tied, setTied] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<Drag | null>(null);

  const ropePos = (color: string) => ({
    x: ROPE_X,
    y: slotY(PALETTE.indexOf(color), PALETTE.length),
  });
  const knotPos = (color: string) => ({
    x: KNOT_X,
    y: slotY(knotOrder.indexOf(color), knotOrder.length),
  });

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const board = boardRef.current;
    if (!board) {
      return;
    }

    const onMove = (e: PointerEvent) => {
      const rect = board.getBoundingClientRect();
      setDragging((prev) => prev && { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const onUp = (e: PointerEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const knotEl = target?.closest<HTMLElement>("[data-knot-color]");
      const knotColor = knotEl?.dataset.knotColor;

      setDragging((current) => {
        if (current && knotColor === current.color) {
          setTied((prev) => {
            if (prev.has(current.color)) {
              return prev;
            }
            const next = new Set(prev);
            next.add(current.color);
            if (next.size === PALETTE.length) {
              setTimeout(onComplete, 250);
            }
            return next;
          });
        }
        return null;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // Intentionally keyed on the dragged colour, not the whole `dragging`
    // object: a new drag is a new colour, and re-subscribing on every
    // in-flight position update would churn the listeners on every pointer
    // move instead of once per drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging?.color, onComplete]);

  const startDrag = (color: string) => {
    if (tied.has(color)) {
      return;
    }
    const { x, y } = ropePos(color);
    setDragging({ color, x, y });
  };

  return (
    <div className="minigame minigame-net" data-minigame="net">
      <p className="minigame-instructions">{t("minigame.net.instructions")}</p>

      <div
        ref={boardRef}
        className="net-board"
        style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
      >
        <svg className="net-svg" width={BOARD_WIDTH} height={BOARD_HEIGHT}>
          {[...tied].map((color) => {
            const a = ropePos(color);
            const b = knotPos(color);
            return (
              <line key={color} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={5} />
            );
          })}
          {dragging && (
            <line
              x1={ropePos(dragging.color).x}
              y1={ropePos(dragging.color).y}
              x2={dragging.x}
              y2={dragging.y}
              stroke={dragging.color}
              strokeWidth={5}
              strokeDasharray="7 5"
            />
          )}
        </svg>

        {PALETTE.map((color) => {
          const { x, y } = ropePos(color);
          return (
            <button
              key={color}
              type="button"
              data-rope-color={color}
              className={`net-rope-end ${tied.has(color) ? "net-rope-end-tied" : ""}`}
              style={{ left: x, top: y, backgroundColor: color, touchAction: "none" }}
              onPointerDown={() => startDrag(color)}
              disabled={tied.has(color)}
              aria-label={t("minigame.net.ropeLabel")}
            />
          );
        })}

        {knotOrder.map((color) => {
          const { x, y } = knotPos(color);
          return (
            <div
              key={color}
              data-knot-color={color}
              className={`net-knot ${tied.has(color) ? "net-knot-tied" : ""}`}
              style={{ left: x, top: y, borderColor: color }}
            />
          );
        })}
      </div>
    </div>
  );
}
