import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ReimbursementClaim, SessionUser } from "../../../api/contracts";
import { ReimbursementClaimDialog } from "./ReimbursementClaimDialog";

const api = vi.hoisted(() => ({ save: vi.fn(), upload: vi.fn(), refetch: vi.fn() }));
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
const claim = {
  id: "claim",
  documentNumber: "BX-001",
  status: "pending_submission",
  createdBy: "admin",
  fundingLines: [],
} as unknown as ReimbursementClaim;
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../../api/administration", () => ({
  uploadFile: api.upload,
  usePrincipalIdentities: () => ({ data: { items: [] } }),
}));
vi.mock("../../../api/reimbursementLedger", () => ({
  useReimbursementClaim: () => ({ data: { item: claim }, refetch: api.refetch }),
  useSaveReimbursementClaim: () => ({ mutateAsync: api.save, isPending: false }),
}));
vi.mock("../../../components/WorkspaceUi", () => ({
  ModalShell: ({ children }: { children: ReactNode }) => <section role="dialog">{children}</section>,
  PageSkeleton: () => null,
  formatMoney: String,
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
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverMock });
beforeEach(() => {
  api.refetch.mockResolvedValue({ isError: false });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const user = { id: "admin", role: "admin" } as SessionUser;

it("keeps a save failure and the current draft in the form without a success notification", async () => {
  api.save.mockRejectedValueOnce(new Error("报销单版本已变化"));
  render(<ReimbursementClaimDialog claimId="claim" user={user} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "保存报销单" }));
  await screen.findByText("报销单版本已变化");
  expect(screen.getByDisplayValue("BX-001")).toBeInTheDocument();
  expect(feedback.success).not.toHaveBeenCalled();
  expect(api.save).toHaveBeenCalledWith({ id: "claim", item: { ...claim, fundingLines: [] } });
});

it("reports an uploaded attachment as saved even when detail refresh fails, and only retries the read", async () => {
  api.upload.mockResolvedValueOnce({});
  api.refetch.mockRejectedValueOnce(new Error("详情暂不可用")).mockResolvedValueOnce({ isError: false });
  render(<ReimbursementClaimDialog claimId="claim" user={user} onClose={vi.fn()} />);
  const file = new File(["attachment"], "报销扫描件.pdf", { type: "application/pdf" });
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("缺少附件输入");
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText("附件已上传，但报销单详情刷新失败：详情暂不可用");
  expect(feedback.success).toHaveBeenCalledWith("报销单附件已上传", file.name);
  expect(feedback.success).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "重试读取详情" }));
  await waitFor(() =>
    expect(screen.queryByText("附件已上传，但报销单详情刷新失败：详情暂不可用")).not.toBeInTheDocument(),
  );
  expect(api.upload).toHaveBeenCalledTimes(1);
  expect(api.refetch).toHaveBeenCalledTimes(2);
});
