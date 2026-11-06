import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as InspectionModel from "./model";
import { afterEach, expect, it, vi } from "vitest";

import { InspectionEntry } from "./InspectionEntry";
import { useInspectionEntryEditor } from "./useInspectionEntryEditor";

const api = vi.hoisted(() => ({
  save: vi.fn(),
  submit: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  detail: {},
  resume: "",
}));
const feedback = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
const photo = new File(["photo"], "异常照片.jpg", { type: "image/jpeg" });
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../hooks/useUnsavedChanges", () => ({ useUnsavedChanges: vi.fn() }));
vi.mock("../../hooks/useIsMobileLayout", () => ({ useIsMobileLayout: () => false }));
vi.mock("../../api/infrastructure", () => ({ useRooms: () => ({ data: { items: [] }, refetch: vi.fn() }) }));
vi.mock("../../api/animalManagement", () => ({
  useAnimalInspectionEdit: () => api.detail,
  useRefreshAnimalInspections: () => api.refresh,
  useAnimalInspectionCatalog: () => ({ data: { nodes: [], modules: [] }, refetch: vi.fn() }),
  useSaveAnimalInspection: () => ({ mutateAsync: api.save, isPending: false }),
  useSubmitAnimalInspection: () => ({ mutateAsync: api.submit, isPending: false }),
  uploadAnimalInspectionPhoto: api.upload,
}));
vi.mock("../../components/ui/MobilePage", () => ({ MobilePage: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../components/WorkspaceUi", () => ({
  WorkspaceToolbar: ({ actions, primaryAction }: { actions: ReactNode; primaryAction: ReactNode }) => (
    <>
      {actions}
      {primaryAction}
    </>
  ),
  AsyncActionButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  PageSkeleton: () => null,
  PageState: ({ title, retry }: { title: string; retry: () => void }) => (
    <div>
      {title}
      <button onClick={retry}>重新加载</button>
    </div>
  ),
}));
vi.mock("./InspectionModuleForms", () => ({
  InspectionModuleForm: ({ onFinding }: { onFinding: (node: { moduleCode: string; code: string }) => void }) => (
    <button onClick={() => onFinding({ moduleCode: "basicAssessment", code: "finding" })}>添加异常照片</button>
  ),
}));
vi.mock("./InspectionDialogs", () => ({
  FindingCaptureDialog: ({
    onConfirm,
  }: {
    onConfirm: (value: { answer: { note: string }; files: File[] }) => void;
  }) => <button onClick={() => onConfirm({ answer: { note: "异常" }, files: [photo] })}>选取照片</button>,
  ReferenceImageDialog: () => null,
}));
vi.mock("./model", async (load) => ({
  ...(await load<typeof InspectionModel>()),
  resumeInspectionId: () => api.resume,
  setResumeInspectionId: vi.fn(),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }),
});

afterEach(() => {
  cleanup();
  api.detail = {};
  api.resume = "";
  vi.clearAllMocks();
});

it("reports the final submission once and retries retained photos without resubmitting the inspection", async () => {
  api.save.mockResolvedValue({ item: { id: "inspection", updatedAt: "saved-v1" } });
  api.submit.mockResolvedValue({
    findings: [{ id: "finding-id", moduleCode: "basicAssessment", nodeCode: "finding" }],
  });
  api.upload.mockRejectedValueOnce(new Error("上传中断")).mockResolvedValueOnce(undefined);
  render(<InspectionEntry navigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "添加异常照片" }));
  fireEvent.click(screen.getByRole("button", { name: "选取照片" }));
  fireEvent.click(screen.getByRole("button", { name: "提交巡检" }));
  await screen.findByText("巡检已提交，1 张照片尚未上传");
  expect(feedback.success).not.toHaveBeenCalled();
  expect(feedback.warning).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "提交巡检" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重试上传照片" }));
  await waitFor(() =>
    expect(feedback.success).toHaveBeenCalledWith("巡检照片已补传", undefined, "inspection:inspection:submission"),
  );
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.upload.mock.calls).toEqual([
    ["inspection", "finding-id", photo],
    ["inspection", "finding-id", photo],
  ]);
  expect(screen.queryByText("巡检已提交，1 张照片尚未上传")).not.toBeInTheDocument();
});

function resumeDraft() {
  api.resume = "inspection";
  api.detail = {
    data: {
      item: { id: "inspection", roomId: "room", facility: "设施", moduleCodes: ["basicAssessment"], updatedAt: "v1" },
      answers: [],
    },
  };
}

it("offers retry when the initial resumed draft fails instead of leaving a skeleton", () => {
  api.resume = "inspection";
  const retry = vi.fn();
  api.detail = { isError: true, refetch: retry };
  render(<InspectionEntry navigate={vi.fn()} />);
  expect(screen.getByText("巡检工作区加载失败")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("blocks pending resume actions, then submits an unchanged saved draft with its version and one final refresh", async () => {
  api.resume = "inspection";
  api.detail = { isLoading: true };
  const editor = renderHook(() => useInspectionEntryEditor());
  expect(editor.result.current.ready).toBe(false);
  await act(async () => {
    await editor.result.current.saveDraft();
    await editor.result.current.submitInspection();
  });
  expect(api.save).not.toHaveBeenCalled();
  expect(api.submit).not.toHaveBeenCalled();
  resumeDraft();
  editor.rerender();
  await waitFor(() => expect(editor.result.current.ready).toBe(true));
  api.submit.mockResolvedValue({ findings: [] });
  await act(() => editor.result.current.submitInspection());
  expect(api.save).not.toHaveBeenCalled();
  expect(api.submit).toHaveBeenCalledExactlyOnceWith({
    id: "inspection",
    expectedUpdatedAt: "v1",
    deferInvalidate: true,
  });
  expect(api.refresh).toHaveBeenCalledOnce();
});

it("keeps edits made during explicit saving and sends the returned version without retrying a conflict", async () => {
  resumeDraft();
  let finish!: (value: { item: { id: string; updatedAt: string } }) => void;
  api.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const editor = renderHook(() => useInspectionEntryEditor());
  await waitFor(() => expect(editor.result.current.ready).toBe(true));
  let saving!: Promise<void>;
  act(() => {
    saving = editor.result.current.saveDraft();
  });
  act(() => editor.result.current.setRoomId("changed-room"));
  api.detail = {
    data: {
      item: { id: "inspection", roomId: "old-room", moduleCodes: ["basicAssessment"], updatedAt: "old-response" },
      answers: [],
    },
  };
  editor.rerender();
  await act(async () => {
    finish({ item: { id: "inspection", updatedAt: "v2" } });
    await saving;
  });
  expect(editor.result.current.roomId).toBe("changed-room");
  api.save.mockRejectedValueOnce(new Error("草稿版本冲突"));
  await act(() => editor.result.current.submitInspection());
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1][0]).toMatchObject({
    roomId: "changed-room",
    expectedUpdatedAt: "v2",
    deferInvalidate: true,
  });
  expect(editor.result.current.operationError).toBe("草稿版本冲突");
  expect(editor.result.current.roomId).toBe("changed-room");
  expect(api.submit).not.toHaveBeenCalled();
});

it("waits for the current resume response and keeps the editor available after initialization", async () => {
  resumeDraft();
  api.detail = { ...api.detail, isFetching: true };
  const editor = renderHook(() => useInspectionEntryEditor());
  expect(editor.result.current.ready).toBe(false);
  await act(() => editor.result.current.submitInspection());
  expect(api.submit).not.toHaveBeenCalled();
  api.detail = {
    data: {
      item: {
        id: "inspection",
        roomId: "latest-room",
        facility: "设施",
        moduleCodes: ["basicAssessment"],
        updatedAt: "latest",
      },
      answers: [],
    },
    isFetching: false,
  };
  editor.rerender();
  await waitFor(() => expect(editor.result.current.roomId).toBe("latest-room"));
  api.submit.mockResolvedValue({ findings: [] });
  await act(() => editor.result.current.submitInspection());
  expect(api.submit).toHaveBeenCalledExactlyOnceWith({
    id: "inspection",
    expectedUpdatedAt: "latest",
    deferInvalidate: true,
  });
  editor.unmount();

  resumeDraft();
  const page = render(<InspectionEntry navigate={vi.fn()} />);
  await screen.findByRole("button", { name: "保存草稿" });
  api.detail = { isError: true, refetch: vi.fn() };
  page.rerender(<InspectionEntry navigate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  expect(screen.queryByText("巡检工作区加载失败")).not.toBeInTheDocument();
});
