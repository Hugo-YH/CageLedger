import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { DialogActivityContext } from "../state/dialogActivity";
import { useOperationFeedback } from "./useOperationFeedback";

const operations = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  message: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("../components/TaskFeedbackContext", () => ({ useTaskFeedback: () => ({ operations }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps one operation API through strict effects and parent renders, then ignores unmounted callbacks", () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
  const { result, rerender, unmount } = renderHook(useOperationFeedback, { wrapper });
  const previous = result.current;
  rerender();
  expect(result.current).toBe(previous);
  act(() => previous.success("已保存", "批次A"));
  expect(operations.success).toHaveBeenCalledExactlyOnceWith("已保存", "批次A");
  unmount();
  previous.error("较晚的请求失败");
  expect(operations.error).not.toHaveBeenCalled();
});

it("suppresses a retiring dialog's async feedback while keeping active dialog feedback", () => {
  let active = true;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(DialogActivityContext.Provider, { value: active }, children);
  const { result, rerender } = renderHook(useOperationFeedback, { wrapper });
  result.current.message.success("已复制");
  expect(operations.message.success).toHaveBeenCalledOnce();
  const previous = result.current;
  active = false;
  rerender();
  previous.success("较晚的保存结果");
  previous.message.error("较晚的复制失败");
  expect(operations.success).not.toHaveBeenCalled();
  expect(operations.message.error).not.toHaveBeenCalled();
});
