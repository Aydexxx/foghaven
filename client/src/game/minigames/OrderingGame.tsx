import { useMemo, useState } from "react";
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
 */
export function OrderingGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<number[]>(() => shuffledOrder(ITEM_COUNT));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

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

  return (
    <div className="minigame minigame-ordering" data-minigame="ordering">
      <p className="minigame-instructions">{t("minigame.ordering.instructions")}</p>

      <ul className="ordering-list">
        {items.map((value, index) => (
          <li
            key={value}
            draggable
            className={`ordering-item ${draggedIndex === index ? "ordering-item-dragging" : ""} ${
              overIndex === index ? "ordering-item-over" : ""
            }`}
            onDragStart={() => setDraggedIndex(index)}
            onDragEnd={() => {
              setDraggedIndex(null);
              setOverIndex(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggedIndex !== null) {
                reorder(draggedIndex, index);
              }
              setDraggedIndex(null);
              setOverIndex(null);
            }}
          >
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}
