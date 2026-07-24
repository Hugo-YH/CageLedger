import { type ReactNode, useRef, useState } from "react";

import { TaskFeedbackContext, type TaskFeedbackApi, type TaskItem } from "./TaskFeedbackContext";

export function TaskFeedbackProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const sequence = useRef(0);

  const api: TaskFeedbackApi = {
    start(task) {
      const id = `task-${sequence.current++}`;
      setTasks((current) => [...current, { ...task, id, status: "running" as const }].slice(-4));
      return id;
    },
    update(id, task) {
      setTasks((current) => current.map((item) => (item.id === id ? { ...item, ...task } : item)));
    },
    complete(id, detail) {
      setTasks((current) => current.map((item) => (item.id === id ? { ...item, detail, status: "completed" } : item)));
    },
    fail(id, detail) {
      setTasks((current) => current.map((item) => (item.id === id ? { ...item, detail, status: "failed" } : item)));
    },
    dismiss(id) {
      setTasks((current) => current.filter((item) => item.id !== id));
    },
  };

  return (
    <TaskFeedbackContext.Provider value={api}>
      {children}
      <aside className="task-feedback-center" aria-label="后台任务状态" aria-live="polite">
        {tasks.map((task) => (
          <article className={`task-feedback ${task.status}`} key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <span>{task.detail}</span>
            </div>
            {task.status === "running" ? <span className="task-feedback-spinner" aria-label="正在处理" /> : null}
            {task.status !== "running" ? (
              <button
                className="ghost compact"
                type="button"
                aria-label={`关闭${task.title}提示`}
                onClick={() => api.dismiss(task.id)}
              >
                关闭
              </button>
            ) : null}
          </article>
        ))}
      </aside>
    </TaskFeedbackContext.Provider>
  );
}
