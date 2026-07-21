import { useTranslation } from "react-i18next";
import type { ClientTask } from "@foghaven/shared";

interface TaskListProps {
  tasks: ClientTask[];
}

/**
 * The local player's own task list. Whatever the server privately dealt this
 * player — a real list or a fake one — is rendered in exactly the same way;
 * there is nothing in this component that could tell the two apart.
 */
export function TaskList({ tasks }: TaskListProps) {
  const { t } = useTranslation();

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="task-list">
      <h2>{t("taskList.heading")}</h2>
      <ul>
        {tasks.map((task) => {
          const done = task.completedSteps >= task.totalSteps;
          return (
            <li key={task.id} className={done ? "task-done" : undefined}>
              <span className="task-check">{done ? "✓" : "○"}</span>
              <span className="task-room">{t(`rooms.${task.room}`)}</span>
              {task.totalSteps > 1 && (
                <span className="task-progress">
                  {task.completedSteps}/{task.totalSteps}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
