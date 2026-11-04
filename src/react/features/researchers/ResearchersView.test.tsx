import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Researcher } from "../../../contracts/researchers";
import type { SessionUser } from "../../api/contracts";
import { ApiError } from "../../api/client";
import { AntdProvider } from "../../components/ui";
import { UiProvider } from "../../state/ui";
import { ResearcherDetailDialog } from "./ResearcherDetailDialog";
import { ResearchersView } from "./ResearchersView";

const feedback = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  message: { info: vi.fn() },
}));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../hooks/useUnsavedChanges", () => ({ useUnsavedChanges: () => () => Promise.resolve(true) }));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
  preview: vi.fn(),
  import: vi.fn(),
}));
vi.mock("../../api/researchers", () => ({
  useResearchers: (params: unknown) => api.list(params),
  useResearcher: () => api.detail(),
  useSaveResearcher: () => ({ mutateAsync: api.save, isPending: false }),
  usePreviewResearcherImport: () => ({ mutateAsync: api.preview }),
  useImportResearchers: () => ({ mutateAsync: api.import }),
}));

const person: Researcher = {
  id: "stable-person-id",
  account: "source-account",
  name: "张三",
  alias: "小张",
  department: "动物中心",
  position: "实验员",
  gender: "男",
  mobile: "13800000001",
  telephone: "020-12345678",
  email: "a@example.com",
  enterpriseEmail: "work@example.com",
  englishName: "Zhang San",
  sourceDisabled: true,
  activationStatus: "已激活",
  createdAt: "created",
  updatedAt: "version-1",
};

function host(children: React.ReactNode) {
  return (
    <UiProvider>
      <AntdProvider>{children}</AntdProvider>
    </UiProvider>
  );
}

beforeEach(() => {
  api.list.mockReset().mockReturnValue({
    data: { items: [person], departments: [person.department], page: { total: 1 } },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  api.detail.mockReset().mockImplementation(() => ({ data: { item: person }, refetch: api.refetch }));
  api.refetch
    .mockReset()
    .mockResolvedValue({ data: { item: { ...person, mobile: "13900000002", updatedAt: "version-2" } } });
  api.save.mockReset();
  api.preview.mockReset();
  api.import.mockReset();
  feedback.success.mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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
  vi.unstubAllGlobals();
});

it("lets a room administrator search and view the independent directory without write actions", async () => {
  render(host(<ResearchersView user={{ role: "room_admin" } as SessionUser} />));
  expect(screen.queryByRole("button", { name: "导入 Excel" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索实验人员" }), { target: { value: "source-account" } });
  fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索实验人员" }), { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: "source-account", offset: 0 })),
  );
  fireEvent.click(screen.getByRole("button", { name: "查看" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("source-account");
  expect(screen.queryByRole("button", { name: "保存资料" })).toBeNull();
  expect(screen.getByRole("dialog")).toHaveTextContent("Zhang San");
});

it("preserves source fields and sends stable ID and original version while editing contact information", async () => {
  api.save.mockResolvedValue({ item: { ...person, mobile: "13900000002" } });
  const onSaved = vi.fn();
  render(host(<ResearcherDetailDialog id={person.id} canEdit onClose={vi.fn()} onSaved={onSaved} />));
  expect(screen.getByDisplayValue("source-account")).toHaveAttribute("readonly");
  fireEvent.change(screen.getByRole("textbox", { name: "手机" }), { target: { value: "13900000002" } });
  fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  const payload = api.save.mock.calls[0][0];
  expect(payload).toMatchObject({
    id: "stable-person-id",
    expectedUpdatedAt: "version-1",
    item: {
      mobile: "13900000002",
      sourceDisabled: true,
      activationStatus: "已激活",
      englishName: "Zhang San",
      gender: "男",
    },
  });
  expect(payload.item).not.toHaveProperty("account");
  expect(payload.item).not.toHaveProperty("id");
});

it("keeps the exact import action name through loading and failure, retries the same intent, and reports counts once", async () => {
  const counts = { created: 2, updated: 3, unchanged: 4, invalid: 0 };
  api.preview.mockResolvedValue({
    fileName: "人员.xlsx",
    total: 9,
    counts,
    rows: [
      {
        sheet: "通讯录",
        row: 2,
        account: "a",
        name: "张三",
        action: "update",
        changes: [{ field: "mobile", label: "手机", before: "old", after: "new" }],
        warnings: ["同名人员保留独立账号"],
        errors: [],
      },
    ],
    confirmationToken: "token",
    canImport: true,
  });
  api.import.mockResolvedValue({ total: 9, counts, updatedAt: "version", replayed: false });
  let rejectFirst!: (reason: Error) => void;
  api.import.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectFirst = reject;
      }),
  );
  const rendered = render(host(<ResearchersView user={{ role: "admin" } as SessionUser} />));
  fireEvent.click(screen.getByRole("button", { name: "导入 Excel" }));
  expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();
  const input = rendered.baseElement.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [new File(["fixture"], "人员.xlsx")] } });
  expect(await screen.findByText("新增 2")).toBeInTheDocument();
  expect(screen.getByText("更新 3")).toBeInTheDocument();
  expect(screen.getByText("未变 4")).toBeInTheDocument();
  expect(screen.getByText("错误 0")).toBeInTheDocument();
  expect(screen.getByText("同名人员保留独立账号")).toBeInTheDocument();
  expect(api.import).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "确认导入" })).toHaveAttribute("aria-busy", "true"));
  expect(screen.getByRole("button", { name: "确认导入" })).toBeDisabled();
  await act(() => Promise.resolve(rejectFirst(new ApiError("测试连接中断", 503, {}))));
  expect(await screen.findByText(/测试连接中断/)).toBeInTheDocument();
  const retry = screen.getByRole("button", { name: "确认导入" });
  expect(retry).toHaveAttribute("aria-busy", "false");
  expect(retry).not.toBeDisabled();
  expect(screen.getByText("新增 2")).toBeInTheDocument();
  fireEvent.click(retry);
  await waitFor(() =>
    expect(feedback.success).toHaveBeenCalledWith("实验人员信息已导入", "新增 2 人，更新 3 人，未变 4 人，错误 0 行"),
  );
  expect(api.import).toHaveBeenCalledTimes(2);
  expect(api.import.mock.calls[1][0]).toEqual(api.import.mock.calls[0][0]);
  expect(feedback.success).toHaveBeenCalledTimes(1);
});

it("keeps an edit draft through background refresh and CAS conflict and only reloads on explicit action", async () => {
  api.save.mockRejectedValue(new ApiError("资料已更新", 409, {}));
  const element = host(<ResearcherDetailDialog id={person.id} canEdit onClose={vi.fn()} onSaved={vi.fn()} />);
  const rendered = render(element);
  fireEvent.change(screen.getByRole("textbox", { name: "手机" }), { target: { value: "draft-mobile" } });
  api.detail.mockImplementation(() => ({
    data: { item: { ...person, mobile: "background-mobile", updatedAt: "new-version" } },
    refetch: api.refetch,
  }));
  rendered.rerender(host(<ResearcherDetailDialog id={person.id} canEdit onClose={vi.fn()} onSaved={vi.fn()} />));
  expect(screen.getByRole("textbox", { name: "手机" })).toHaveValue("draft-mobile");
  fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
  expect(await screen.findByText("资料已被其他人更新，当前草稿已保留")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "手机" })).toHaveValue("draft-mobile");
  expect(screen.getByRole("button", { name: "保存资料" })).toBeDisabled();
  expect(api.refetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加载最新资料核对" }));
  expect(await screen.findByText("13900000002")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "手机" })).toHaveValue("draft-mobile");
  expect(api.save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "放弃当前草稿，按最新资料重新编辑" }));
  expect(screen.getByRole("textbox", { name: "手机" })).toHaveValue("13900000002");
});
