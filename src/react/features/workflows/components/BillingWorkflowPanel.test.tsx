import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useContext, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SessionUser } from "../../../api/contracts";
import type { BillingWorkflow } from "../../../api/workflows";
import { BillingWorkflowPanel } from "./BillingWorkflowPanel";
import { WorkflowLockContext } from "./workflowLockContext";

const api = vi.hoisted(() => ({ batch: vi.fn(), advance: vi.fn(), refetch: vi.fn() }));
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
const tasks = vi.hoisted(() => ({
  start: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  partial: vi.fn(),
  fail: vi.fn(),
}));
const items = ["one", "two"].map(
  (id) =>
    ({
      id,
      pi: id === "one" ? "负责人甲" : "负责人乙",
      month: "2026-11",
      workflowStatus: "statement_sent",
    }) as BillingWorkflow,
);
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../../components/TaskFeedbackContext", () => ({ useTaskFeedback: () => tasks }));
vi.mock("../../../hooks/useListPageBounds", () => ({ useListPageBounds: () => {} }));
vi.mock("../../../hooks/useSelectionScope", () => ({ useSelectionScope: () => {} }));
vi.mock("../../../state/workspaceMemory", () => ({
  useWorkspaceMemory: (_key: string, initial: unknown) => useState(initial),
  useWorkspaceScroll: () => {},
}));
vi.mock("../../../api/useBatchAdvanceWorkflow", () => ({
  useBatchAdvanceWorkflow: () => ({ run: api.batch, completed: 0 }),
}));
vi.mock("../../../api/workflows", () => ({
  useBillingWorkflows: () => ({ data: { items, page: { total: 2 } }, isSuccess: true, refetch: api.refetch }),
  useAdvanceWorkflow: () => ({ mutateAsync: api.advance }),
}));
vi.mock("../../../components/WorkspaceUi", () => ({ Pager: () => null }));
vi.mock("../../../components/ui/ListViewControls", () => ({ ListViewControls: () => null }));
vi.mock("../../../components/ui", () => ({
  CommandBar: ({ primaryAction }: { primaryAction: ReactNode }) => primaryAction,
  HelpPopover: () => null,
}));
vi.mock("../../../components/BatchFailureDetails", () => ({
  BatchFailureDetails: ({ failures }: { failures: string[] }) => (
    <ul>
      {failures.map((failure) => (
        <li key={failure}>{failure}</li>
      ))}
    </ul>
  ),
}));
vi.mock("./LedgerListShared", () => ({ QueryFeedback: () => null }));
vi.mock("./WorkflowRegistrationModal", () => ({ WorkflowRegistrationModal: () => null }));
vi.mock("./WorkflowDetailModal", () => ({ WorkflowDetailModal: () => null }));
vi.mock("./WorkflowReimbursementRecordingModal", () => ({ WorkflowReimbursementRecordingModal: () => null }));
vi.mock("./WorkflowRevokeModal", () => ({ WorkflowRevokeModal: () => null }));
vi.mock("./BillingWorkflowTable", () => ({
  BillingWorkflowTable: ({ onToggleAllLockable }: { onToggleAllLockable: () => void }) => {
    const lock = useContext(WorkflowLockContext);
    return (
      <>
        <button onClick={onToggleAllLockable}>选择两条</button>
        <button
          onClick={() =>
            void lock?.onAdvance({ workflowId: "one", toStatus: "statement_locked", note: "锁定结算流程" })
          }
        >
          锁定一条
        </button>
      </>
    );
  },
}));
vi.mock("antd", () => ({
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Popconfirm: ({ children, onConfirm }: { children: ReactNode; onConfirm: () => void }) => (
    <>
      {children}
      <button onClick={onConfirm}>确认批量锁定</button>
    </>
  ),
  Alert: ({ title, description }: { title: ReactNode; description: ReactNode }) => (
    <div role="alert">
      {title}
      {description}
    </div>
  ),
  Select: () => null,
  Tag: () => null,
}));
beforeEach(() => {
  tasks.start.mockReturnValue("batch-task");
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const user = { id: "admin", role: "admin", billingLockAllowed: true } as SessionUser;
function selectBatch() {
  render(<BillingWorkflowPanel user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "选择两条" }));
  fireEvent.click(screen.getByRole("button", { name: "确认批量锁定" }));
}

it("finishes a successful batch in one task notification without a page success banner", async () => {
  api.batch.mockResolvedValue({ completed: items.map((item) => ({ workflowId: item.id })), failures: [] });
  selectBatch();
  await waitFor(() =>
    expect(tasks.complete).toHaveBeenCalledWith("batch-task", "已锁定 2 条结算流程。", "结算流程已批量锁定"),
  );
  expect(api.batch).toHaveBeenCalledWith(
    items.map((item) => ({ workflowId: item.id, toStatus: "statement_locked", note: "批量锁定结算流程" })),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("uses a partial task result and retains the failed workflow details", async () => {
  api.batch.mockResolvedValue({
    completed: [{ workflowId: "one" }],
    failures: [{ item: { workflowId: "two" }, message: "没有锁定权限" }],
  });
  selectBatch();
  await screen.findByText("负责人乙（没有锁定权限）");
  expect(tasks.partial).toHaveBeenCalledOnce();
  expect(tasks.complete).not.toHaveBeenCalled();
});

it("keeps a single lock failure local and emits success only after the write succeeds", async () => {
  api.advance.mockRejectedValueOnce(new Error("版本已变化")).mockResolvedValueOnce({});
  render(<BillingWorkflowPanel user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "锁定一条" }));
  await screen.findByText("版本已变化");
  expect(feedback.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "锁定一条" }));
  await waitFor(() => expect(feedback.success).toHaveBeenCalledWith("结算流程已锁定", "2026-11 · 负责人甲"));
  expect(api.advance).toHaveBeenCalledTimes(2);
});
