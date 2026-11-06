import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { BillingWorkflow } from "../../../api/workflows";
import { WorkflowRegistrationModal } from "./WorkflowRegistrationModal";
import { WorkflowReimbursementRecordingModal } from "./WorkflowReimbursementRecordingModal";
import { WorkflowRevokeModal } from "./WorkflowRevokeModal";
import { DialogActivityContext } from "../../../state/dialogActivity";

const api = vi.hoisted(() => ({ advance: vi.fn(), record: vi.fn(), upload: vi.fn(), funding: vi.fn(), known: true }));
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../../api/workflows", () => ({
  useAdvanceWorkflow: () => ({ mutateAsync: api.advance }),
  recordWorkflowReimbursement: api.record,
  uploadWorkflowAttachment: api.upload,
  useWorkflowFundingBookOptions: (id: string, enabled = true) => {
    api.funding(id, enabled);
    return {
      data: enabled
        ? {
            items: api.known ? [{ value: "FUND-1", label: "FUND-1" }] : [],
            piFundingBookOptions: [],
            piFundingBookNos: api.known ? ["FUND-1"] : [],
          }
        : undefined,
    };
  },
}));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({
    children,
    open,
    title,
    onOk,
    okText,
  }: {
    children: ReactNode;
    open: boolean;
    title: ReactNode;
    onOk?: () => void;
    okText?: string;
  }) =>
    open ? (
      <section role="dialog">
        {title}
        {children}
        {onOk ? (
          <button type="button" onClick={onOk}>
            {okText}
          </button>
        ) : null}
      </section>
    ) : null,
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
  api.known = true;
  api.funding.mockClear();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const target = {
  id: "workflow",
  month: "2026-11",
  pi: "负责人甲",
  totalAmount: 25.5,
  sourceType: "pi_merged",
  signedStatementReturned: true,
  signedStatementNote: "签字件",
  reimbursementFormReturned: true,
  reimbursementFormNote: "报销备注",
  reimbursementForms: [{ formNo: "BX-001", amount: 25.5, fundingBookNo: "FUND-1" }],
} as BillingWorkflow;

it.each([
  { totalAmount: 0, reimbursementFormReturned: true },
  { totalAmount: 25.5, reimbursementFormReturned: false },
])("keeps funding reads disabled for unused fields ($totalAmount/$reimbursementFormReturned)", async (values) => {
  render(<WorkflowRegistrationModal target={{ ...target, ...values }} onCancel={vi.fn()} onRegistered={vi.fn()} />);
  await screen.findByRole("button", { name: "保存登记" });
  expect(api.funding).toHaveBeenCalled();
  expect(api.funding.mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it("loads on use, preserves hidden reimbursement drafts, and keeps amount validation", async () => {
  render(
    <WorkflowRegistrationModal
      target={{ ...target, reimbursementFormReturned: false }}
      onCancel={vi.fn()}
      onRegistered={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("switch", { name: "报销单" }));
  await waitFor(() => expect(api.funding).toHaveBeenLastCalledWith("workflow", true));
  fireEvent.change(screen.getByPlaceholderText("报销单号"), { target: { value: "KEEP-DRAFT" } });
  fireEvent.click(screen.getByRole("switch", { name: "报销单" }));
  await waitFor(() => expect(api.funding).toHaveBeenLastCalledWith("workflow", false));
  fireEvent.click(screen.getByRole("switch", { name: "报销单" }));
  expect(await screen.findByPlaceholderText("报销单号")).toHaveValue("KEEP-DRAFT");
  expect(screen.getByRole("combobox")).toHaveValue("FUND-1");
  fireEvent.change(screen.getByPlaceholderText("金额（元）"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "保存登记" }));
  await screen.findByText("请填写金额");
  expect(api.advance).not.toHaveBeenCalled();
});

it("disables retained inactive reads and gives a switched workflow its own draft", async () => {
  const registered = vi.fn();
  const renderModal = (active: boolean, item: BillingWorkflow | null) => (
    <DialogActivityContext.Provider value={active}>
      <WorkflowRegistrationModal target={item} onCancel={vi.fn()} onRegistered={registered} />
    </DialogActivityContext.Provider>
  );
  const view = render(renderModal(true, target));
  await waitFor(() => expect(api.funding).toHaveBeenLastCalledWith("workflow", true));
  view.rerender(renderModal(false, target));
  await waitFor(() => expect(api.funding).toHaveBeenLastCalledWith("workflow", false));
  const next = {
    ...target,
    id: "workflow-next",
    reimbursementForms: [{ formNo: "NEXT-DRAFT", amount: 25.5, fundingBookNo: "FUND-1" }],
  };
  view.rerender(renderModal(true, next));
  await waitFor(() => expect(api.funding).toHaveBeenLastCalledWith("workflow-next", true));
  expect(screen.getByPlaceholderText("报销单号")).toHaveValue("NEXT-DRAFT");
  view.rerender(renderModal(false, null));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it("reports a completed return registration once without changing the workflow payload", async () => {
  api.advance.mockResolvedValueOnce({});
  const registered = vi.fn();
  render(<WorkflowRegistrationModal target={target} onCancel={vi.fn()} onRegistered={registered} />);
  fireEvent.click(screen.getByRole("button", { name: "保存登记" }));
  await waitFor(() => expect(registered).toHaveBeenCalledOnce());
  expect(feedback.success).toHaveBeenCalledWith("结算单交回登记已保存", "2026-11 · 负责人甲");
  expect(api.advance).toHaveBeenCalledWith({
    workflowId: "workflow",
    toStatus: "statement_archived",
    registration: {
      reimbursementForms: target.reimbursementForms,
      signedStatementReturned: true,
      signedStatementNote: "签字件",
      reimbursementFormReturned: true,
      reimbursementFormNote: "报销备注",
    },
  });
});

it("does not save or report success before unknown funding book confirmation", async () => {
  api.known = false;
  api.advance.mockResolvedValueOnce({});
  render(<WorkflowRegistrationModal target={target} onCancel={vi.fn()} onRegistered={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "保存登记" }));
  await screen.findByText("确认经费本信息");
  expect(api.advance).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
  await screen.findByRole("button", { name: "保存登记" });
  fireEvent.click(screen.getByRole("button", { name: "确认继续" }));
  await waitFor(() => expect(feedback.success).toHaveBeenCalledOnce());
  expect(api.advance).toHaveBeenCalledOnce();
});

it("reports a scan upload independently of registration", async () => {
  api.upload.mockResolvedValueOnce({ originalName: "签字扫描件.pdf" });
  render(<WorkflowRegistrationModal target={target} onCancel={vi.fn()} onRegistered={vi.fn()} />);
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("缺少扫描件输入");
  const file = new File(["signed"], "签字扫描件.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(feedback.success).toHaveBeenCalledWith("结算单扫描件已上传", file.name));
  expect(api.upload).toHaveBeenCalledWith("workflow", "settlement", file);
  expect(api.advance).not.toHaveBeenCalled();
});

it("reports reimbursement recording after the write and preserves the form payload", async () => {
  api.record.mockResolvedValueOnce({});
  const recorded = vi.fn();
  render(<WorkflowReimbursementRecordingModal target={target} onCancel={vi.fn()} onRecorded={recorded} />);
  fireEvent.change(screen.getByPlaceholderText("报销单号"), { target: { value: "BX-NEW" } });
  fireEvent.change(screen.getByPlaceholderText("金额（元）"), { target: { value: "25.5" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "FUND-1" } });
  fireEvent.click(screen.getByRole("button", { name: "保存补录" }));
  await waitFor(() => expect(recorded).toHaveBeenCalledOnce());
  expect(api.record).toHaveBeenCalledWith("workflow", [{ formNo: "BX-NEW", amount: 25.5, fundingBookNo: "FUND-1" }]);
  expect(feedback.success).toHaveBeenCalledWith("报销单补录已保存", "2026-11 · 负责人甲");
});

it("keeps a revoke failure in the modal, then emits success only for the successful retry", async () => {
  api.advance.mockRejectedValueOnce(new Error("流程版本已变化")).mockResolvedValueOnce({});
  const close = vi.fn();
  render(<WorkflowRevokeModal target={{ workflow: target, toStatus: "statement_generated" }} onCancel={close} />);
  fireEvent.change(screen.getByPlaceholderText("请填写撤回原因"), { target: { value: "重核金额" } });
  fireEvent.click(screen.getByRole("button", { name: /确认撤回/ }));
  await screen.findByText("流程版本已变化");
  expect(close).not.toHaveBeenCalled();
  expect(feedback.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /确认撤回/ }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(feedback.success).toHaveBeenCalledWith("结算流程已撤回", "2026-11 · 负责人甲");
  expect(api.advance).toHaveBeenLastCalledWith({
    workflowId: "workflow",
    toStatus: "statement_generated",
    note: "重核金额",
  });
});
