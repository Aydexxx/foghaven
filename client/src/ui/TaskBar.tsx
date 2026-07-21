import { useTranslation } from "react-i18next";

interface TaskBarProps {
  completed: number;
  total: number;
}

/**
 * The shared progress bar — public room state, so every player, real task or
 * fake, sees the exact same numbers. Only townsfolk completions ever move it;
 * see the server's `handleTaskInteract`.
 */
export function TaskBar({ completed, total }: TaskBarProps) {
  const { t } = useTranslation();
  const pct = total > 0 ? Math.min(100, (completed / total) * 100) : 0;

  return (
    <div className="task-bar">
      <span className="task-bar-label">{t("taskBar.label")}</span>
      <div className="task-bar-track">
        <div className="task-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="task-bar-count">{total > 0 ? `${completed} / ${total}` : "—"}</span>
    </div>
  );
}
