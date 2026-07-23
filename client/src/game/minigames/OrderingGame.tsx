import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

const ITEM_COUNT = 4;

function shuffledOrder(count: number): number[] {
  const items = Array.from({ length: count }, (_, i) => i + 1);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  // A shuffle that happens to land on the sorted order isn't a puzzle.
  return items.every((n, i) => n === i + 1) ? shuffledOrder(count) : items;
}

/**
 * Drag numbered items into ascending order. The only mini-game whose
 * interaction is reordering a single list, rather than matching two things
 * or hitting a timed target.
 *
 * Built on Pointer Events rather than HTML5 drag-and-drop (`draggable`,
 * `onDragStart`/`onDragOver`/`onDrop`) because the native DnD API never
 * fires from touch input on mobile browsers. `document.elementFromPoint`
 * finds whichever item the pointer is currently over, mirroring
 * `WireConnectingGame`'s pointer-drag pattern, and reorders live as the drag
 * passes over each item — the same feel the previous HTML5 version had.
 */
export function OrderingGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<number[]>(() => shuffledOrder(ITEM_COUNT));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (from === to) {
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);

      if (next.every((n, i) => n === i + 1)) {
        setTimeout(onComplete, 200);
      }
      return next;
    });
  };

  useEffect(() => {
    if (draggedIndex === null) {
      return;
    }

    const onMove = (e: PointerEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const itemEl = target?.closest<HTMLElement>("[data-item-index]");
      const hoverIndex = itemEl ? Number(itemEl.dataset.itemIndex) : null;
      if (hoverIndex === null || Number.isNaN(hoverIndex)) {
        return;
      }
      setDraggedIndex((current) => {
        if (current === null || current === hoverIndex) {
          return current;
        }
        reorder(current, hoverIndex);
        return hoverIndex;
      });
    };

    const onUp = () => setDraggedIndex(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggedIndex]);

  return (
    <div className="minigame minigame-ordering" data-minigame="ordering">
      <p className="minigame-instructions">{t("minigame.ordering.instructions")}</p>

      <ul className="ordering-list">
        {items.map((value, index) => (
          <li
            key={value}
            data-item-index={index}
            className={`ordering-item ${draggedIndex === index ? "ordering-item-dragging" : ""}`}
            style={{ touchAction: "none" }}
            onPointerDown={() => setDraggedIndex(index)}
          >
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}
