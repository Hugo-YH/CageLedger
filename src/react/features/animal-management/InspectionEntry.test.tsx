import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as InspectionModel from "./model";
import { afterEach, expect, it, vi } from "vitest";

import { InspectionEntry } from "./InspectionEntry";

const api = vi.hoisted(() => ({ save: vi.fn(), submit: vi.fn(), upload: vi.fn() }));
const feedback = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
const photo = new File(["photo"], "异常照片.jpg", { type: "image/jpeg" });
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../hooks/useUnsavedChanges", () => ({ useUnsavedChanges: vi.fn() }));
vi.mock("../../hooks/useIsMobileLayout", () => ({ useIsMobileLayout: () => false }));
vi.mock("../../api/infrastructure", () => ({ useRooms: () => ({ data: { items: [] } }) }));
vi.mock("../../api/animalManagement", () => ({
  useAnimalInspection: () => ({}),
  useAnimalInspectionCatalog: () => ({ data: { nodes: [], modules: [] } }),
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
  PageState: () => null,
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
  resumeInspectionId: () => "",
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
  vi.clearAllMocks();
});

it("reports the final submission once and retries retained photos without resubmitting the inspection", async () => {
  api.save.mockResolvedValue({ item: { id: "inspection" } });
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
