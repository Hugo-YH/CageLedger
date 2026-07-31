import { createContext, useContext } from "react";

export type TaskStatus = "running" | "completed" | "failed";

export type TaskItem = {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  progress?: number;
};

export type TaskFeedbackApi = {
  start: (task: Omit<TaskItem, "id" | "status">) => string;
  update: (id: string, task: Partial<Omit<TaskItem, "id" | "status">>) => void;
  complete: (id: string, detail: string) => void;
  fail: (id: string, detail: string) => void;
  dismiss: (id: string) => void;
};

export const TaskFeedbackContext = createContext<TaskFeedbackApi | null>(null);

export function useTaskFeedback() {
  const context = useContext(TaskFeedbackContext);
  if (!context) throw new Error("useTaskFeedback must be used within TaskFeedbackProvider");
  return context;
}
