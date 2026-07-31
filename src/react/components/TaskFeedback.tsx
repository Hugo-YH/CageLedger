import { App, Progress } from "antd";
import { type ReactNode, useRef } from "react";

import { TaskFeedbackContext, type TaskFeedbackApi, type TaskItem } from "./TaskFeedbackContext";

export function TaskFeedbackProvider({ children }: { children: ReactNode }) {
  const { notification } = App.useApp();
  const sequence = useRef(0);
  const tasks = useRef(new Map<string, TaskItem>());

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
    });
  };

  const api: TaskFeedbackApi = {
    start(task) {
      const id = `task-${sequence.current++}`;
      const next = { ...task, id, status: "running" as const };
      tasks.current.set(id, next);
      show(next);
      return id;
    },
    update(id, task) {
      const previous = tasks.current.get(id);
      const next = {
        id,
        title: task.title || previous?.title || "后台任务",
        detail: task.detail || previous?.detail || "正在处理...",
        status: "running" as const,
        progress: task.progress,
      };
      tasks.current.set(id, next);
      show(next);
    },
    complete(id, detail) {
      const previous = tasks.current.get(id);
      const next = { id, title: previous?.title || "任务完成", detail, status: "completed" as const };
      tasks.current.set(id, next);
      show(next);
    },
    fail(id, detail) {
      const previous = tasks.current.get(id);
      const next = { id, title: previous?.title || "任务失败", detail, status: "failed" as const };
      tasks.current.set(id, next);
      show(next);
    },
    dismiss(id) {
      tasks.current.delete(id);
      notification.destroy(id);
    },
  };

  return <TaskFeedbackContext.Provider value={api}>{children}</TaskFeedbackContext.Provider>;
}
