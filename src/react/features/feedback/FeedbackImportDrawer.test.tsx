import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { FeedbackImportDrawer } from "./FeedbackImportDrawer";

const api = vi.hoisted(() => ({ submit: vi.fn(), refetch: vi.fn() }));
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverMock });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    addListener() {},
    removeEventListener() {},
    removeListener() {},
  }),
});
vi.mock("../../api/feedback", () => ({
  useImportFeedback: () => ({ isPending: false, mutateAsync: api.submit }),
  useFeedbackImportPreview: () => ({
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: api.refetch,
    data: {
      repository: "https://example.test/owner/repo",
      hasMore: false,
      items: [
        {
          number: 1,
          title: "历史工单",
          kind: "bug",
          module: "笼卡",
          reporter: "张三",
          reporterSource: "record",
          status: "pending",
          importable: true,
          reason: "",
        },
        {
          number: 2,
          title: "已经关联",
          kind: "question",
          module: "笼卡",
          reporter: "登记人",
          reporterSource: "gitea",
          status: "resolved",
          importable: false,
          reason: "已关联到系统反馈",
        },
      ],
    },
  }),
}));
afterEach(() => {
  cleanup();
  api.submit.mockReset();
  api.refetch.mockReset();
});

function open() {
  render(<FeedbackImportDrawer onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择工单 #1" }));
}
it("keeps nonimportable rows disabled and blocks duplicate submits", async () => {
  let resolve: ((value: unknown) => void) | undefined;
  api.submit.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  open();
  expect(screen.getByRole("checkbox", { name: "选择工单 #2" })).toBeDisabled();
  const submit = screen.getByRole("button", { name: "导入所选（1）" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "关闭导入窗口" })).toBeDisabled();
  resolve?.({ items: [{ number: 1, outcome: "imported", message: "已导入" }] });
  await waitFor(() => expect(screen.getByLabelText("导入结果")).toHaveTextContent("导入 1 条"));
});
it("replays the stable request after transport failure", async () => {
  api.submit
    .mockRejectedValueOnce(new Error("连接中断"))
    .mockResolvedValueOnce({ items: [{ number: 1, outcome: "imported", message: "已导入" }] });
  open();
  fireEvent.click(screen.getByRole("button", { name: "导入所选（1）" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "重试导入" })).toBeVisible());
  const first = api.submit.mock.calls[0][0];
  fireEvent.click(screen.getByRole("button", { name: "重试导入" }));
  await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
  expect(api.submit.mock.calls[1][0]).toEqual(first);
});
it("keeps per-issue failures selected and starts a fresh retry batch", async () => {
  api.submit
    .mockResolvedValueOnce({ items: [{ number: 1, outcome: "failed", message: "权限不足" }] })
    .mockResolvedValueOnce({ items: [{ number: 1, outcome: "imported", message: "已导入" }] });
  open();
  fireEvent.click(screen.getByRole("button", { name: "导入所选（1）" }));
  await waitFor(() => expect(screen.getByLabelText("导入结果")).toHaveTextContent("失败 1 条"));
  await waitFor(() => expect(screen.getByRole("button", { name: "导入所选（1）" })).not.toHaveClass("ant-btn-loading"));
  const first = api.submit.mock.calls[0][0].requestId;
  fireEvent.click(screen.getByRole("button", { name: "导入所选（1）" }));
  await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
  expect(api.submit.mock.calls[1][0].numbers).toEqual([1]);
  expect(api.submit.mock.calls[1][0].requestId).not.toBe(first);
});
