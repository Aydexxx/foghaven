import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";
import { MINIGAME_TILE_COLORS as PALETTE } from "../../theme/minigameTileColors";
const BOARD_WIDTH = 300;
const BOARD_HEIGHT = 200;
const PLUG_X = 30;
const SOCKET_X = BOARD_WIDTH - 30;

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
 * Drag each coloured plug to its matching socket. The only mini-game built
 * around live pointer dragging between two distinct points, rather than
 * reordering a single list or a click/keypad interaction.
 */
export function WireConnectingGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const socketOrder = useMemo(shuffledPalette, []);
  const boardRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<Drag | null>(null);

  const plugPos = (color: string) => ({
    x: PLUG_X,
    y: slotY(PALETTE.indexOf(color), PALETTE.length),
  });
  const socketPos = (color: string) => ({
    x: SOCKET_X,
    y: slotY(socketOrder.indexOf(color), socketOrder.length),
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
      const socketEl = target?.closest<HTMLElement>("[data-socket-color]");
      const socketColor = socketEl?.dataset.socketColor;

      setDragging((current) => {
        if (current && socketColor === current.color) {
          setConnected((prev) => {
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
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging?.color, onComplete]);

  const startDrag = (color: string) => {
    if (connected.has(color)) {
      return;
    }
    const { x, y } = plugPos(color);
    setDragging({ color, x, y });
  };

  return (
    <div className="minigame minigame-wires" data-minigame="wires">
      <p className="minigame-instructions">{t("minigame.wires.instructions")}</p>

      <div
        ref={boardRef}
        className="wires-board"
        style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
      >
        <svg className="wires-svg" width={BOARD_WIDTH} height={BOARD_HEIGHT}>
          {[...connected].map((color) => {
            const a = plugPos(color);
            const b = socketPos(color);
            return (
              <line key={color} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={4} />
            );
          })}
          {dragging && (
            <line
              x1={plugPos(dragging.color).x}
              y1={plugPos(dragging.color).y}
              x2={dragging.x}
              y2={dragging.y}
              stroke={dragging.color}
              strokeWidth={4}
              strokeDasharray="6 4"
            />
          )}
        </svg>

        {PALETTE.map((color) => {
          const { x, y } = plugPos(color);
          return (
            <button
              key={color}
              type="button"
              data-plug-color={color}
              className={`wire-plug ${connected.has(color) ? "wire-plug-connected" : ""}`}
              style={{ left: x, top: y, backgroundColor: color }}
              onPointerDown={() => startDrag(color)}
              disabled={connected.has(color)}
              aria-label={t("minigame.wires.plugLabel")}
            />
          );
        })}

        {socketOrder.map((color) => {
          const { x, y } = socketPos(color);
          return (
            <div
              key={color}
              data-socket-color={color}
              className={`wire-socket ${connected.has(color) ? "wire-socket-connected" : ""}`}
              style={{ left: x, top: y, borderColor: color }}
            />
          );
        })}
      </div>
    </div>
  );
}
