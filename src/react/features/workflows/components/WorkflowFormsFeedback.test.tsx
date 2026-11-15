import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { BillingWorkflow } from "../../../api/workflows";
import { WorkflowRegistrationModal } from "./WorkflowRegistrationModal";
import { WorkflowReimbursementRecordingModal } from "./WorkflowReimbursementRecordingModal";
import { WorkflowRevokeModal } from "./WorkflowRevokeModal";
import { DialogActivityContext } from "../../../state/dialogActivity";

const api = vi.hoisted(() => ({
  advance: vi.fn(),
  record: vi.fn(),
  upload: vi.fn(),
  funding: vi.fn(),
  refetchFunding: vi.fn(),
  fundingError: false,
  known: true,
}));
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../../api/workflows", () => ({
  useAdvanceWorkflow: () => ({ mutateAsync: api.advance }),
  recordWorkflowReimbursement: api.record,
  uploadWorkflowAttachment: api.upload,
  useWorkflowFundingBookOptions: (id: string, enabled = true) => {
    api.funding(id, enabled);
    return {
      data:
        enabled && !api.fundingError
          ? {
              items: api.known ? [{ value: "FUND-1", label: "FUND-1" }] : [],
              piFundingBookOptions: [],
              piFundingBookNos: api.known ? ["FUND-1"] : [],
            }
          : undefined,
      isError: enabled && api.fundingError,
      isFetching: false,
      refetch: api.refetchFunding,
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
    onCancel,
    closable,
    keyboard,
    mask,
  }: {
    children: ReactNode;
    open: boolean;
    title: ReactNode;
    onOk?: () => void;
    okText?: string;
    onCancel?: () => void;
    closable?: boolean | { disabled?: boolean };
    keyboard?: boolean;
    mask?: boolean | { closable?: boolean };
  }) =>
    open ? (
      <section role="dialog">
        {title}
        {onCancel ? (
          <>
            <button
              type="button"
              aria-label="关闭弹窗"
              disabled={closable === false || (typeof closable === "object" && closable.disabled)}
              onClick={onCancel}
              onKeyDown={(event) => {
                if (event.key === "Escape" && keyboard !== false) onCancel();
              }}
            />
            <button
              type="button"
              aria-label="点击遮罩"
              disabled={typeof mask === "object" && mask.closable === false}
              onClick={onCancel}
            />
          </>
        ) : null}
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
  api.fundingError = false;
  api.funding.mockClear();
  api.refetchFunding.mockResolvedValue({});
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function renderWorkflowForm(kind: "registration" | "recording", cancel: () => void) {
  return render(
    kind === "registration" ? (
      <WorkflowRegistrationModal target={target} onCancel={cancel} onRegistered={vi.fn()} />
    ) : (
      <WorkflowReimbursementRecordingModal target={target} onCancel={cancel} onRecorded={vi.fn()} />
    ),
  );
}

function expectCloseBlocked(cancel: ReturnType<typeof vi.fn>) {
  const dialog = screen.getByRole("dialog");
  for (const name of [/取\s*消/, "关闭弹窗", "点击遮罩"]) {
    const button = within(dialog).getByRole("button", { name });
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  fireEvent.keyDown(within(dialog).getByRole("button", { name: "关闭弹窗" }), { key: "Escape" });
  expect(cancel).not.toHaveBeenCalled();
}

it.each(["registration", "recording"] as const)(
  "blocks every close path during %s saving and restores closing with the draft after a failure",
  async (kind) => {
    const write = deferred<unknown>();
    const action = kind === "registration" ? api.advance : api.record;
    action.mockReturnValueOnce(write.promise);
    const cancel = vi.fn();
    renderWorkflowForm(kind, cancel);
    fireEvent.change(screen.getByPlaceholderText("报销单号"), { target: { value: "KEEP-DRAFT" } });
    if (kind === "recording") {
      fireEvent.change(screen.getByPlaceholderText("金额（元）"), { target: { value: "25.5" } });
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "FUND-1" } });
    }
    if (kind === "registration") {
      const form = document.querySelector("form");
      if (!form) throw new Error("缺少交回登记表单");
      fireEvent.submit(form);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "保存补录" }));
    }
    expectCloseBlocked(cancel);
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expectCloseBlocked(cancel);

    await act(async () => {
      write.reject(new Error("保存未完成，请重试"));
      await write.promise.catch(() => undefined);
    });
    await screen.findByText("保存未完成，请重试");
    expect(screen.getByPlaceholderText("报销单号")).toHaveValue("KEEP-DRAFT");
    for (const name of [/取\s*消/, "关闭弹窗", "点击遮罩"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    fireEvent.keyDown(screen.getByRole("button", { name: "关闭弹窗" }), { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(feedback.success).not.toHaveBeenCalled();
  },
);

it.each(["registration", "recording"] as const)(
  "blocks every close path during %s scan upload and restores closing after completion",
  async (kind) => {
    const write = deferred<{ originalName: string }>();
    api.upload.mockReturnValueOnce(write.promise);
    const cancel = vi.fn();
    renderWorkflowForm(kind, cancel);
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error("缺少扫描件输入");
    const file = new File(["scan"], "待上传扫描件.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
    expectCloseBlocked(cancel);

    await act(async () => {
      write.resolve({ originalName: file.name });
      await write.promise;
    });
    await screen.findByText(file.name);
    expect(screen.getByRole("button", { name: /取\s*消/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭弹窗" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(feedback.success).toHaveBeenCalledOnce();
    expect(api.advance).not.toHaveBeenCalled();
    expect(api.record).not.toHaveBeenCalled();
  },
);

it("retries recording funding options in place without replacing edited reimbursement fields", async () => {
  api.fundingError = true;
  const cancel = vi.fn();
  const view = renderWorkflowForm("recording", cancel);
  fireEvent.change(screen.getByPlaceholderText("报销单号"), { target: { value: "KEEP-RECORDING" } });
  fireEvent.change(screen.getByPlaceholderText("金额（元）"), { target: { value: "39" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "MANUAL-FUND" } });
  api.refetchFunding.mockImplementationOnce(() => {
    api.fundingError = false;
    return Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  await waitFor(() => expect(api.refetchFunding).toHaveBeenCalledOnce());
  view.rerender(<WorkflowReimbursementRecordingModal target={target} onCancel={cancel} onRecorded={vi.fn()} />);
  expect(screen.queryByText("无法读取最新版实验申请汇总表；可手动填写经费本编号。")).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("报销单号")).toHaveValue("KEEP-RECORDING");
  expect(screen.getByPlaceholderText("金额（元）")).toHaveValue("39.00");
  expect(screen.getByRole("combobox")).toHaveValue("MANUAL-FUND");
  expect(api.record).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it("opens the reimbursement number help from a focusable button and dismisses it with Escape", async () => {
  renderWorkflowForm("registration", vi.fn());
  const help = screen.getByRole("button", { name: "报销单号生成说明" });
  help.focus();
  expect(help).toHaveFocus();
  fireEvent.click(help);
  expect(help).toHaveAttribute("aria-expanded", "true");
  await screen.findByText("已按本月自动生成 BXD1001YYYYMM000，请核对是否正确并完善报销单号");
  fireEvent.keyDown(help, { key: "Escape" });
  expect(help).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByPlaceholderText("报销单号")).toHaveValue("BX-001");
});

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
  await waitFor(() => expect(screen.getByRole("button", { name: /保存登记/ })).not.toHaveClass(/ant-btn-loading/));
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
