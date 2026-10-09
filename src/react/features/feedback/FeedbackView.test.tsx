import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { FeedbackCreateDrawer, FeedbackDetailDrawer } from "./FeedbackView";
import { ApiError } from "../../api/client";
import { clearDiagnostics, recordDiagnosticError } from "../../diagnostics/collector";

const api = vi.hoisted(() => ({ create: vi.fn(), upload: vi.fn(), comment: vi.fn() }));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    addEventListener() {},
    addListener() {},
    matches: false,
    removeEventListener() {},
    removeListener() {},
  }),
});
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverMock });

vi.mock("../../api/feedback", () => ({
  uploadFeedbackAttachment: api.upload,
  useCreateFeedback: () => ({ isPending: false, mutateAsync: api.create }),
  useAddFeedbackComment: (id: string) => ({ isPending: false, mutateAsync: (body: unknown) => api.comment(id, body) }),
  useFeedbackDetail: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }),
  useFeedbackIntegration: () => ({ data: undefined, isError: false }),
  useFeedbackList: () => ({
    data: { items: [], total: 0 },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useQueueFeedbackSync: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSetFeedbackEncounter: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("../../api/administration", () => ({ useSystemInfo: () => ({ data: { build: "210" } }) }));

afterEach(() => {
  clearDiagnostics();
  cleanup();
  api.create.mockReset();
  api.upload.mockReset();
  api.comment.mockReset();
});

function detail(id: string) {
  return {
    data: {
      item: {
        id,
        number: 1,
        title: id,
        kind: "bug",
        module: "笼位管理",
        description: "描述",
        status: "pending",
        syncStatus: "pending",
        createdBy: { id: "user", name: "用户" },
        createdAt: "2026-10-06T00:00:00Z",
        updatedAt: "2026-10-06T00:00:00Z",
        encounterCount: 0,
        encountered: false,
        assignees: [],
        fixVersion: "",
        lastSyncedAt: "",
        environment: { appVersion: "1", build: "1", page: "cages", browser: "test" },
        issueNumber: null,
        version: 1,
      },
      attachments: [],
      comments: [],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function drawer(key: string, created = vi.fn()) {
  return <FeedbackCreateDrawer key={key} build="210" open page="cages" onClose={vi.fn()} onCreated={created} />;
}

function fillDraft() {
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "保存失败" } });
  fireEvent.change(screen.getByLabelText("涉及模块"), { target: { value: "笼位管理" } });
  fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "点击保存后出现错误" } });
}

it("includes diagnostics by default, previews the exact snapshot, and supports opting out", async () => {
  recordDiagnosticError(new TypeError("SECRET"), "react");
  api.create.mockResolvedValue({ item: { id: "with-diagnostics" } });
  const view = render(drawer("with-diagnostics"));
  expect(screen.getByRole("checkbox", { name: "提交反馈时附带诊断信息" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "预览诊断信息" }));
  expect(screen.getByRole("region", { name: "诊断信息预览" })).toHaveTextContent("TypeError");
  expect(screen.getByRole("region", { name: "诊断信息预览" })).not.toHaveTextContent("SECRET");
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  expect(api.create.mock.calls[0][0].diagnostics.events).toHaveLength(1);
  view.rerender(drawer("without-diagnostics"));
  fireEvent.click(screen.getByRole("checkbox", { name: "提交反馈时附带诊断信息" }));
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
  expect(api.create.mock.calls[1][0]).not.toHaveProperty("diagnostics");
});

it("retries an unknown submission with the same payload after new diagnostic events occur", async () => {
  api.create
    .mockRejectedValueOnce(new TypeError("connection lost"))
    .mockResolvedValueOnce({ item: { id: "reconciled" } });
  render(drawer("uncertain"));
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
  await waitFor(() => expect(screen.getByText("connection lost")).toBeVisible());
  expect(screen.getByRole("checkbox", { name: "提交反馈时附带诊断信息" })).toBeDisabled();
  recordDiagnosticError(new Error("another private error"), "runtime");
  fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
  expect(api.create.mock.calls[1][0]).toEqual(api.create.mock.calls[0][0]);
});

it("starts each new creation with a fresh request id", async () => {
  api.create.mockResolvedValue({ item: { id: "feedback-1" } });
  const first = vi.fn();
  const view = render(drawer("first", first));
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
  await waitFor(() => expect(first).toHaveBeenCalledWith("feedback-1"));
  const firstRequestId = api.create.mock.calls[0][0].requestId;

  const second = vi.fn();
  view.rerender(drawer("second", second));
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
  await waitFor(() => expect(second).toHaveBeenCalledWith("feedback-1"));
  expect(api.create).toHaveBeenCalledTimes(2);
  expect(api.create.mock.calls[1][0].requestId).not.toBe(firstRequestId);
});

it("locks duplicate submit while creation is pending", async () => {
  let resolveCreate: ((value: { item: { id: string } }) => void) | undefined;
  api.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
  );
  render(drawer("pending"));
  fillDraft();
  const submit = screen.getByRole("button", { name: /提\s*交/ });
  fireEvent.click(submit);
  fireEvent.click(submit);
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  resolveCreate?.({ item: { id: "feedback-pending" } });
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
});

it("keeps failed screenshots for a retry without creating another feedback", async () => {
  api.create.mockResolvedValue({ item: { id: "feedback-1" } });
  api.upload.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ id: "file-1" });
  render(drawer("retry"));
  fillDraft();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [new File(["image"], "screen.png", { type: "image/png" })] } });
  await waitFor(() => expect(screen.getByText("screen.png")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
  await waitFor(() =>
    expect(screen.getByText("反馈已提交，但部分截图上传失败。本地已保留，可重试。")).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "重试上传" }));
  await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.upload.mock.calls[1][1]).toBe(api.upload.mock.calls[0][1]);
});

it("does not carry a partial supplement request into another feedback detail", async () => {
  api.comment.mockResolvedValue({ item: { id: "comment-1" } });
  api.upload.mockRejectedValue(new Error("offline"));
  const view = render(<FeedbackDetailDrawer detail={detail("feedback-1")} isAdmin={false} open onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("追加说明内容"), { target: { value: "第一条补充" } });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input!, { target: { files: [new File(["image"], "screen.png", { type: "image/png" })] } });
  await waitFor(() => expect(screen.getByText("screen.png")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /追加说明/ }));
  await waitFor(() =>
    expect(screen.getByText("补充说明已保存，但部分截图上传失败。本地已保留，可重试。")).toBeInTheDocument(),
  );
  const firstRequestId = api.comment.mock.calls[0][1].requestId;

  view.rerender(<FeedbackDetailDrawer detail={detail("feedback-2")} isAdmin={false} open onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("追加说明内容"), { target: { value: "第二条补充" } });
  fireEvent.click(screen.getByRole("button", { name: /追加说明/ }));
  await waitFor(() => expect(api.comment).toHaveBeenCalledTimes(2));
  expect(api.comment.mock.calls[1][0]).toBe("feedback-2");
  expect(api.comment.mock.calls[1][1].requestId).not.toBe(firstRequestId);
});

it("hides legacy deletion archives and notifies the list once", () => {
  const archived = detail("archived") as unknown as { data: { item: Record<string, unknown> } };
  Object.assign(archived.data.item, {
    status: "deleted",
    syncStatus: "removed",
    issueNumber: 9,
    issueUrl: "https://example.test/issues/9",
  });
  const onRemoved = vi.fn();
  render(<FeedbackDetailDrawer detail={archived as never} isAdmin open onClose={vi.fn()} onRemoved={onRemoved} />);
  expect(screen.getByText("反馈已删除", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText("描述")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "我也遇到" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "同步 Gitea" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("追加说明内容")).not.toBeInTheDocument();
  expect(onRemoved).toHaveBeenCalledTimes(1);
});

it("removes cached content after a detail 404 and lets the user return to the refreshed list", () => {
  const removed = {
    ...(detail("cached") as unknown as Record<string, unknown>),
    isError: true,
    error: new ApiError("反馈已删除", 404, {}),
  };
  const onClose = vi.fn();
  const onRemoved = vi.fn();
  const view = render(
    <FeedbackDetailDrawer detail={removed as never} isAdmin open onClose={onClose} onRemoved={onRemoved} />,
  );
  expect(screen.getByText("反馈已删除", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText("描述")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  view.rerender(
    <FeedbackDetailDrawer detail={removed as never} isAdmin open onClose={onClose} onRemoved={onRemoved} />,
  );
  expect(onRemoved).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps cached feedback and retry for transient errors instead of treating them as deletion", () => {
  const failed = {
    ...(detail("network") as unknown as Record<string, unknown>),
    isError: true,
    error: new ApiError("服务暂时不可用", 503, {}),
  };
  const onRemoved = vi.fn();
  render(<FeedbackDetailDrawer detail={failed as never} isAdmin open onClose={vi.fn()} onRemoved={onRemoved} />);
  expect(screen.getByText("描述")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  expect(screen.queryByText("反馈已删除")).not.toBeInTheDocument();
  expect(onRemoved).not.toHaveBeenCalled();
});
