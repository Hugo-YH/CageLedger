import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { App, Progress } from "antd";
import { type ReactNode, useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import type { SessionResponse } from "../api/contracts";
import { queryKeys } from "../api/queryKeys";
import {
  TaskFeedbackContext,
  type FeedbackLevel,
  type OperationFeedbackApi,
  type TaskFeedbackApi,
  type TaskItem,
  type TaskStatus,
} from "./TaskFeedbackContext";

function createFeedbackScope(client: QueryClient) {
  const actor = () => client.getQueryData<SessionResponse>(queryKeys.session)?.user?.id ?? "anonymous";
  let current = actor();
  let generation = 0;
  const snapshot = () => {
    const next = actor();
    if (next !== current) {
      current = next;
      generation += 1;
    }
    return `${current}:${generation}`;
  };
  return {
    snapshot,
    subscribe: (listener: () => void) =>
      client.getQueryCache().subscribe(() => {
        snapshot();
        listener();
      }),
  };
}

/** Subscribe to existing session data; feedback never starts another session request. */
function useFeedbackScope() {
  const client = useQueryClient();
  const store = useMemo(() => createFeedbackScope(client), [client]);
  const scope = useSyncExternalStore(store.subscribe, store.snapshot);
  return { scope, isCurrent: store.snapshot };
}

function createFeedbackOwner(
  notification: ReturnType<typeof App.useApp>["notification"],
  message: ReturnType<typeof App.useApp>["message"],
  scope: string,
  isCurrent: () => string,
) {
  let active = true;
  let sequence = 0;
  const tasks = new Map<string, TaskItem>();
  const notices = new Set<string>();
  const messages = new Set<string>();
  const live = () => active && isCurrent() === scope;
  const nextId = (kind: string) => `feedback:${scope}:${kind}:${sequence++}`;
  const showTask = (task: TaskItem) => {
    if (!live()) return;
    notices.add(task.id);
    notification.open({
      key: task.id,
      closable: { "aria-label": "关闭通知" },
      title: task.title,
      description: (
        <>
          {task.detail}
          {task.status === "running" && task.progress != null ? (
            <Progress percent={task.progress} size="small" strokeLinecap="round" style={{ marginTop: 8 }} />
          ) : null}
        </>
      ),
      duration: task.status === "completed" ? 3 : 0,
      showProgress: task.status === "completed",
      type:
        task.status === "failed"
          ? "error"
          : task.status === "partial"
            ? "warning"
            : task.status === "completed"
              ? "success"
              : "info",
      role: task.status === "failed" ? "alert" : "status",
      onClose: () => {
        notices.delete(task.id);
        tasks.delete(task.id);
      },
    });
  };
  const finish = (id: string, status: TaskStatus, detail: string, title?: string) => {
    const previous = tasks.get(id);
    if (!previous || !live()) return;
    tasks.delete(id);
    showTask({ id, title: title ?? previous.title, detail, status });
  };
  const levels: FeedbackLevel[] = ["success", "info", "warning", "error"];
  const operations = Object.fromEntries([
    ...levels.map((level) => [
      level,
      (title: string, detail?: string, key?: string) => {
        if (!live()) return;
        const id = key ? `feedback:${scope}:operation:${key}` : nextId("operation");
        notices.add(id);
        notification.open({
          key: id,
          closable: { "aria-label": "关闭通知" },
          title,
          description: detail,
          type: level,
          role: level === "error" ? "alert" : "status",
          duration: level === "success" ? 3 : level === "info" ? 5 : 0,
          showProgress: level === "success" || level === "info",
          onClose: () => {
            notices.delete(id);
          },
        });
      },
    ]),
    [
      "message",
      Object.fromEntries(
        levels.map((level) => [
          level,
          (content: string, key?: string) => {
            if (!live()) return;
            const id = `feedback:${scope}:message:${key ?? content}`;
            messages.add(id);
            void message.open({
              key: id,
              type: level,
              content,
              duration: 3,
              onClose: () => {
                messages.delete(id);
              },
            });
          },
        ]),
      ),
    ],
  ]) as OperationFeedbackApi;
  const api: TaskFeedbackApi = {
    isCurrent: live,
    operations,
    start(task) {
      const id = nextId("task");
      if (!live()) return id;
      const next = { ...task, id, status: "running" as const };
      tasks.set(id, next);
      showTask(next);
      return id;
    },
    update(id, task) {
      const previous = tasks.get(id);
      if (!previous || !live()) return;
      const next = { ...previous, ...task };
      tasks.set(id, next);
      showTask(next);
    },
    complete: (id, detail, title) => finish(id, "completed", detail, title),
    fail: (id, detail, title) => finish(id, "failed", detail, title),
    partial: (id, detail, title) => finish(id, "partial", detail, title),
    dismiss(id) {
      tasks.delete(id);
      notices.delete(id);
      notification.destroy(id);
    },
  };
  return {
    api,
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      tasks.clear();
      for (const id of notices) notification.destroy(id);
      for (const id of messages) message.destroy(id);
      notices.clear();
      messages.clear();
    },
  };
}

export function TaskFeedbackProvider({ children }: { children: ReactNode }) {
  const { notification, message } = App.useApp();
  const { scope, isCurrent } = useFeedbackScope();
  const owner = useMemo(
    () => createFeedbackOwner(notification, message, scope, isCurrent),
    [notification, message, scope, isCurrent],
  );
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  return <TaskFeedbackContext.Provider value={owner.api}>{children}</TaskFeedbackContext.Provider>;
}
