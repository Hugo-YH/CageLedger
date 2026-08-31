import { App, Progress } from "antd";
import { type ReactNode, useMemo, useRef } from "react";

import { TaskFeedbackContext, type TaskFeedbackApi, type TaskItem } from "./TaskFeedbackContext";

export function TaskFeedbackProvider({ children }: { children: ReactNode }) {
  const { notification } = App.useApp();
  const sequence = useRef(0);
  const tasks = useRef(new Map<string, TaskItem>());

  const api = useMemo<TaskFeedbackApi>(() => {
    const show = (task: TaskItem) => {
      notification.open({
        key: task.id,
        title: task.title,
        description: (
          <>
            {task.detail}
            {task.status === "running" && task.progress != null ? (
              <Progress percent={task.progress} size="small" strokeLinecap="round" style={{ marginTop: 8 }} />
            ) : null}
          </>
        ),
        duration: task.status === "running" || task.status === "failed" ? 0 : 4.5,
        placement: "bottomRight",
        showProgress: task.status === "completed",
        type: task.status === "failed" ? "error" : task.status === "completed" ? "success" : "info",
        role: task.status === "failed" ? "alert" : "status",
      });
    };

    return {
      start(task) {
        const id = `task-${sequence.current++}`;
        const next = { ...task, id, status: "running" as const };
        tasks.current.set(id, next);
        show(next);
        return id;
      },
      update(id, task) {
        const previous = tasks.current.get(id);
        if (!previous) return;
        const next = {
          ...previous,
          ...task,
        };
        tasks.current.set(id, next);
        show(next);
      },
      complete(id, detail) {
        const previous = tasks.current.get(id);
        if (!previous) return;
        const next = { id, title: previous.title, detail, status: "completed" as const };
        tasks.current.delete(id);
        show(next);
      },
      fail(id, detail) {
        const previous = tasks.current.get(id);
        if (!previous) return;
        const next = { id, title: previous.title, detail, status: "failed" as const };
        tasks.current.delete(id);
        show(next);
      },
      dismiss(id) {
        tasks.current.delete(id);
        notification.destroy(id);
      },
    };
  }, [notification]);

  return <TaskFeedbackContext.Provider value={api}>{children}</TaskFeedbackContext.Provider>;
}
