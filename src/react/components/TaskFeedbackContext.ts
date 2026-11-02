import { createContext, useContext } from "react";

export type TaskStatus = "running" | "completed" | "failed" | "partial";

export type FeedbackLevel = "success" | "info" | "warning" | "error";
export type OperationFeedbackApi = Record<FeedbackLevel, (title: string, detail?: string, key?: string) => void> & {
  message: Record<FeedbackLevel, (content: string, key?: string) => void>;
};

export type TaskItem = {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  progress?: number;
};

export type TaskFeedbackApi = {
  /** Valid for this account/session, including after a page unmount. */
  isCurrent: () => boolean;
  start: (task: Omit<TaskItem, "id" | "status">) => string;
  update: (id: string, task: Partial<Omit<TaskItem, "id" | "status">>) => void;
  complete: (id: string, detail: string, title?: string) => void;
  fail: (id: string, detail: string, title?: string) => void;
  partial: (id: string, detail: string, title?: string) => void;
  dismiss: (id: string) => void;
  operations: OperationFeedbackApi;
};

export const TaskFeedbackContext = createContext<TaskFeedbackApi | null>(null);

export function useTaskFeedback() {
  const context = useContext(TaskFeedbackContext);
  if (!context) throw new Error("useTaskFeedback must be used within TaskFeedbackProvider");
  return context;
}
