import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskFeedbackProvider } from "./TaskFeedback";
import { useTaskFeedback } from "./TaskFeedbackContext";

const notification = vi.hoisted(() => ({ open: vi.fn(), destroy: vi.fn() }));
vi.mock("antd", () => ({ App: { useApp: () => ({ notification }) }, Progress: () => null }));

describe("TaskFeedbackProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the API stable across parent renders", () => {
    const { result, rerender } = renderHook(useTaskFeedback, { wrapper: TaskFeedbackProvider });
    const previous = result.current;
    rerender();
    expect(result.current).toBe(previous);
  });

  it.each(["complete", "fail"] as const)("releases a task after %s and ignores late updates", (finish) => {
    const { result } = renderHook(useTaskFeedback, { wrapper: TaskFeedbackProvider });
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
    const { result } = renderHook(useTaskFeedback, { wrapper: TaskFeedbackProvider });
    const id = result.current.start({ title: "导出", detail: "处理中" });
    result.current.dismiss(id);
    result.current.update(id, { detail: "较晚的进度" });
    expect(notification.destroy).toHaveBeenCalledWith(id);
    expect(notification.open).toHaveBeenCalledTimes(1);
  });
});
