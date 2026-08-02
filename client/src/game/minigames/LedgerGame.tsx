import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

/** Column ids and how many entries belong to each — kept small for a <12s solve. */
const COLUMNS = ["incoming", "outgoing"] as const;
type Column = (typeof COLUMNS)[number];
const ENTRIES_PER_COLUMN = 2;

interface Entry {
  id: string;
  column: Column;
}

function shuffledEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const column of COLUMNS) {
    for (let i = 0; i < ENTRIES_PER_COLUMN; i++) {
      entries.push({ id: `${column}-${i}`, column });
    }
  }
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  return entries;
}

/**
 * Sort the Ledger (8.3, `ledger`, safe). Drag each entry into the column it
 * belongs to. Built on the same live-pointer-drag shape as `NetGame`, but
 * dropping onto one of several zones rather than one fixed matching point —
 * closer to a filing task than a rewiring one.
 *
 * A wrong drop simply bounces the entry back to the tray; there is no
 * `onFail`. Ledger work is tedious, not dangerous — losing your place costs
 * time, never anything else.
 */
export function LedgerGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const entries = useMemo(shuffledEntries, []);
  const [placed, setPlaced] = useState<Record<string, Column>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [bounced, setBounced] = useState<string | null>(null);

  useEffect(() => {
    if (!draggingId) {
      return;
    }
    const onUp = (e: PointerEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const columnEl = target?.closest<HTMLElement>("[data-ledger-column]");
      const column = columnEl?.dataset.ledgerColumn as Column | undefined;
      const entry = entries.find((candidate) => candidate.id === draggingId)!;

      if (column === entry.column) {
        setPlaced((prev) => {
          const next = { ...prev, [entry.id]: column };
          if (Object.keys(next).length === entries.length) {
            setTimeout(onComplete, 220);
          }
          return next;
        });
      } else {
        setBounced(entry.id);
        setTimeout(() => setBounced(null), 260);
      }
      setDraggingId(null);
    };
    const onCancel = () => setDraggingId(null);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [draggingId, entries, onComplete]);

  return (
    <div className="minigame minigame-ledger" data-minigame="ledger">
      <p className="minigame-instructions">{t("minigame.ledger.instructions")}</p>

      <div className="ledger-tray">
        {entries
          .filter((entry) => !placed[entry.id])
          .map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`ledger-entry ${draggingId === entry.id ? "ledger-entry-dragging" : ""} ${bounced === entry.id ? "ledger-entry-bounced" : ""}`}
              style={{ touchAction: "none" }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDraggingId(entry.id);
              }}
            >
              {t(`minigame.ledger.entryLabel.${entry.column}`)}
            </button>
          ))}
      </div>

      <div className="ledger-columns">
        {COLUMNS.map((column) => (
          <div key={column} data-ledger-column={column} className="ledger-column">
            <span className="ledger-column-label">{t(`minigame.ledger.columnLabel.${column}`)}</span>
            <div className="ledger-column-slot">
              {entries
                .filter((entry) => placed[entry.id] === column)
                .map((entry) => (
                  <span key={entry.id} className="ledger-entry ledger-entry-placed">
                    {t(`minigame.ledger.entryLabel.${entry.column}`)}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
