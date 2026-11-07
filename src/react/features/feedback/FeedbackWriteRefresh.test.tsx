import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useFeedbackImportPreview, useFeedbackIntegration, useFeedbackList } from "../../api/feedback";
import type { FeedbackDetail, FeedbackItem } from "../../../contracts/feedback";
import { FeedbackCreateDrawer } from "./FeedbackCreateDrawer";
import { FeedbackDetailPanel } from "./FeedbackDetailDrawer";
import { FeedbackImportDrawer } from "./FeedbackImportDrawer";

const feedback = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), message: { info: vi.fn() } }));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));

const clients: QueryClient[] = [];
const filters = { columnFilters: {}, sortKey: "number" as const, sortDir: "desc" as const, limit: 20, offset: 0 };
const item: FeedbackItem = {
  id: "feedback-1",
  number: 1,
  title: "附件链最终状态",
  kind: "bug",
  module: "反馈",
  description: "描述",
  status: "pending",
  syncStatus: "pending",
  createdBy: { id: "user", name: "用户" },
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-07T00:00:00Z",
  encounterCount: 0,
  encountered: false,
  assignees: [],
  fixVersion: "",
  lastSyncedAt: "",
  environment: { appVersion: "test", build: "test", page: "feedback", browser: "test" },
  issueNumber: null,
  version: 1,
};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  feedback.success.mockClear();
  feedback.warning.mockClear();
});

function json(value: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { headers });
}
function gate<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function ListObservers() {
  useFeedbackList(filters);
  useFeedbackIntegration(true);
  useFeedbackImportPreview("all", 1, true);
  return null;
}

function mount(drawer: React.ReactNode, observers = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      {observers ? <ListObservers /> : null}
      {drawer}
    </QueryClientProvider>,
  );
}
function fillDraft() {
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: item.title } });
  fireEvent.change(screen.getByLabelText("涉及模块"), { target: { value: item.module } });
  fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: item.description } });
}
async function chooseFiles(names: string[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("截图选择器缺少文件输入");
  fireEvent.change(input, {
    target: { files: names.map((name) => new File(["synthetic image"], name, { type: "image/png" })) },
  });
  for (const name of names) await waitFor(() => expect(screen.getByText(name)).toBeVisible());
}

function fixture() {
  const reads = new Map<string, number>();
  const writes: Array<{ path: string; body: RequestInit["body"] }> = [];
  const state: FeedbackDetail = { item: { ...item }, comments: [], attachments: [] };
  let revision = 1;
  let imported = false;
  const upload: { handler: (url: URL, init: RequestInit) => Promise<Response> } = {
    handler: () =>
      Promise.resolve(
        json({ item: { id: "file", name: "附件.png", url: "/api/feedback/attachments/file", size: 100 } }),
      ),
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    if (init.method && init.method !== "GET") {
      writes.push({ path: String(input), body: init.body });
      if (path.endsWith("attachments")) return upload.handler(url, init);
      if (path.endsWith("comments")) {
        state.comments.push({
          id: "comment-1",
          body: "追加说明",
          author: item.createdBy,
          source: "local",
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          attachments: [],
        });
        revision += 1;
        return json({ item: state.comments[0] });
      }
      if (path === "/api/feedback/import") {
        imported = true;
        return json({ items: [{ number: 1, outcome: "imported", feedbackId: item.id, message: "已导入" }] });
      }
      return json({ item });
    }
    reads.set(path, (reads.get(path) || 0) + 1);
    if (path === "/api/feedback") return json({ items: [], total: 0, limit: 20, offset: 0 });
    if (path.endsWith("integration")) return json({ configured: false });
    if (path.endsWith("preview"))
      return json({
        repository: "synthetic",
        page: 1,
        hasMore: false,
        items: [
          {
            number: 1,
            title: "待导入工单",
            kind: "bug",
            module: "反馈",
            reporter: "用户",
            reporterSource: "record",
            status: "pending",
            importable: !imported,
            reason: imported ? "已关联" : "",
          },
        ],
      });
    const etag = `"detail-${revision}"`;
    if (new Headers(init.headers).get("If-None-Match") === etag) return new Response(null, { status: 304 });
    return json(state, { ETag: etag });
  });
  return {
    reads,
    writes,
    upload,
    state,
    changed: () => {
      revision += 1;
    },
  };
}

it("the real import drawer rereads its preview once after a completed batch", async () => {
  const { reads, writes } = fixture();
  mount(<FeedbackImportDrawer onClose={vi.fn()} />, false);
  const checkbox = await screen.findByRole("checkbox", { name: "选择工单 #1" });
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "导入所选（1）" }));
  await waitFor(() => expect(screen.getByLabelText("导入结果")).toHaveTextContent("导入 1 条"));
  expect(reads.get("/api/feedback/import/preview")).toBe(2);
  expect(writes.filter((write) => write.path === "/api/feedback/import")).toHaveLength(1);
  expect(screen.getByRole("checkbox", { name: "选择工单 #1" })).toBeDisabled();
});

it("creation refreshes after a partial upload chain and retries only the failed screenshot with its original identifier", async () => {
  const { reads, writes, upload } = fixture();
  const firstUpload = gate<Response>();
  let uploadNumber = 0;
  upload.handler = async () => {
    uploadNumber += 1;
    if (uploadNumber === 1) return firstUpload.promise;
    if (uploadNumber === 2) return new Response('{"error":"图片暂时不可用"}', { status: 503 });
    return json({ item: { id: "second-file" } });
  };
  const created = vi.fn();
  mount(<FeedbackCreateDrawer build="test" open page="feedback" onClose={vi.fn()} onCreated={created} />);
  await waitFor(() => expect(reads.size).toBe(3));
  fillDraft();
  await chooseFiles(["成功.png", "失败.png"]);
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await waitFor(() => expect(uploadNumber).toBe(1));
  expect(reads.get("/api/feedback")).toBe(1);
  expect(reads.get("/api/feedback/integration")).toBe(1);
  await act(async () => {
    firstUpload.resolve(json({ item: { id: "first-file" } }));
    await firstUpload.promise;
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "重试上传" })).toBeEnabled());
  expect(reads.get("/api/feedback")).toBe(2);
  expect(reads.get("/api/feedback/integration")).toBe(2);
  expect(reads.get("/api/feedback/import/preview")).toBe(1);
  expect(created).not.toHaveBeenCalled();
  const uploadWrites = writes.filter((write) => write.path.includes("/attachments?"));
  expect(uploadWrites).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "重试上传" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(item.id));
  const retried = writes.filter((write) => write.path.includes("/attachments?"));
  expect(retried).toHaveLength(3);
  expect(retried[2].path).toBe(retried[1].path);
  expect(writes.filter((write) => write.path === "/api/feedback")).toHaveLength(1);
  expect(reads.get("/api/feedback")).toBe(3);
  expect(reads.get("/api/feedback/import/preview")).toBe(1);
});

it.each([false, true])(
  "a supplement refreshes the final detail once after its attachment chain (screenshot=%s)",
  async (withScreenshot) => {
    const { reads, state, upload, changed } = fixture();
    const pending = gate<Response>();
    upload.handler = async () => pending.promise;
    mount(<FeedbackDetailPanel id={item.id} open isAdmin={false} onClose={vi.fn()} />);
    await screen.findByLabelText("追加说明内容");
    await waitFor(() => expect(reads.size).toBe(4));
    fireEvent.change(screen.getByLabelText("追加说明内容"), { target: { value: "追加说明" } });
    if (withScreenshot) await chooseFiles(["附加.png"]);
    fireEvent.click(screen.getByRole("button", { name: "追加说明" }));
    if (withScreenshot) {
      await waitFor(() => expect(state.comments).toHaveLength(1));
      expect(reads.get(`/api/feedback/${item.id}`)).toBe(1);
      expect(reads.get("/api/feedback")).toBe(1);
      const attachment = {
        id: "file",
        name: "附加.png",
        mime: "image/png",
        size: 100,
        url: "/api/feedback/attachments/file",
      };
      state.comments[0].attachments.push(attachment);
      changed();
      await act(async () => {
        pending.resolve(json({ item: attachment }));
        await pending.promise;
      });
      await screen.findByRole("link", { name: "附加.png（1 KB）" });
    }
    await waitFor(() => expect(screen.getByLabelText("追加说明内容")).toHaveValue(""));
    await waitFor(() => expect(screen.getByRole("button", { name: "追加说明" })).toBeDisabled());
    expect(reads.get(`/api/feedback/${item.id}`)).toBe(2);
    expect(reads.get("/api/feedback")).toBe(2);
    expect(reads.get("/api/feedback/integration")).toBe(2);
    expect(reads.get("/api/feedback/import/preview")).toBe(1);
  },
);
