import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { queryKeys } from "../api/queryKeys";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskFeedbackProvider } from "./TaskFeedback";
import { useTaskFeedback } from "./TaskFeedbackContext";

const notification = vi.hoisted(() => ({ open: vi.fn(), destroy: vi.fn() }));
const message = vi.hoisted(() => ({ open: vi.fn(), destroy: vi.fn() }));
let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, createElement(TaskFeedbackProvider, null, children));
}
afterEach(cleanup);
vi.mock("antd", () => ({ App: { useApp: () => ({ notification, message }) }, Progress: () => null }));

describe("TaskFeedbackProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient();
    client.setQueryData(queryKeys.session, { user: { id: "actor-a" } });
  });

  it("keeps the API stable across parent renders", () => {
    const { result, rerender } = renderHook(useTaskFeedback, { wrapper: Wrapper });
    const previous = result.current;
    rerender();
    expect(result.current).toBe(previous);
  });

  it.each(["complete", "fail"] as const)("releases a task after %s and ignores late updates", (finish) => {
    const { result } = renderHook(useTaskFeedback, { wrapper: Wrapper });
    const id = result.current.start({ title: "导出", detail: "处理中", progress: 0 });
    result.current.update(id, { progress: 50 });
    result.current[finish](id, "结果");
    expect(notification.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: id, type: finish === "fail" ? "error" : "success" }),
    );
    const calls = notification.open.mock.calls.length;
    result.current.update(id, { progress: 80 });
    result.current[finish](id, "重复回调");
    expect(notification.open).toHaveBeenCalledTimes(calls);
  });

  it("does not revive explicitly dismissed tasks", () => {
    const { result } = renderHook(useTaskFeedback, { wrapper: Wrapper });
    const id = result.current.start({ title: "导出", detail: "处理中" });
    result.current.dismiss(id);
    result.current.update(id, { detail: "较晚的进度" });
    expect(notification.destroy).toHaveBeenCalledWith(id);
    expect(notification.open).toHaveBeenCalledTimes(1);
  });
  it("uses severity, stable message keys and a single task lifecycle", () => {
    const { result } = renderHook(useTaskFeedback, { wrapper: Wrapper });
    result.current.operations.success("已保存", "批次A");
    expect(notification.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "success", duration: 3, role: "status" }),
    );
    result.current.operations.warning("部分完成", "1项待核对");
    expect(notification.open).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning", duration: 0 }));
    result.current.operations.error("导出失败");
    expect(notification.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "error", duration: 0, role: "alert" }),
    );
    result.current.operations.message.success("已复制");
    const key = message.open.mock.calls.at(-1)![0].key;
    result.current.operations.message.success("已复制");
    expect(message.open).toHaveBeenLastCalledWith(expect.objectContaining({ key, duration: 3 }));
    const id = result.current.start({ title: "导出", detail: "处理中" });
    result.current.partial(id, "1项失败", "部分完成");
    expect(notification.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: id, type: "warning", title: "部分完成", duration: 0 }),
    );
  });

  it("clears old account feedback and suppresses late callbacks, including relogin to the same account", () => {
    const { result } = renderHook(useTaskFeedback, { wrapper: Wrapper });
    const previous = result.current;
    const id = previous.start({ title: "旧账号导出", detail: "处理中" });
    previous.operations.message.info("旧账号信息");
    act(() => {
      client.setQueryData(queryKeys.session, { user: { id: "actor-b" } });
    });
    expect(previous.isCurrent()).toBe(false);
    expect(result.current.isCurrent()).toBe(true);
    expect(notification.destroy).toHaveBeenCalledWith(id);
    expect(message.destroy).toHaveBeenCalled();
    const calls = notification.open.mock.calls.length;
    previous.complete(id, "旧任务完成");
    previous.operations.success("旧回调");
    expect(notification.open).toHaveBeenCalledTimes(calls);
    const accountB = result.current;
    act(() => {
      client.setQueryData(queryKeys.session, { user: null });
      client.setQueryData(queryKeys.session, { user: { id: "actor-b" } });
    });
    accountB.operations.error("旧会话回调");
    expect(notification.open).toHaveBeenCalledTimes(calls);
    result.current.operations.success("新会话结果");
    expect(notification.open).toHaveBeenCalledTimes(calls + 1);
  });

  it("a user-close suppresses further task progress without cancelling the business task", () => {
    const { result } = renderHook(useTaskFeedback, { wrapper: Wrapper });
    const id = result.current.start({ title: "导出", detail: "处理中" });
    notification.open.mock.calls.at(-1)![0].onClose();
    result.current.update(id, { detail: "较晚的进度" });
    result.current.complete(id, "完成");
    expect(notification.open).toHaveBeenCalledTimes(1);
  });
});
