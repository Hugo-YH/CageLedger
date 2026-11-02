import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as Antd from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SessionUser } from "../../../api/contracts";
import { ReconciliationPanel } from "./LedgerReconciliationPanel";

const api = vi.hoisted(() => ({ create: vi.fn(), confirm: vi.fn(), reverse: vi.fn(), refetch: vi.fn() }));
const feedback = vi.hoisted(() => ({ success: vi.fn() }));
const claim = {
  id: "claim",
  documentNumber: "BX-001",
  fundingOwner: "经费负责人",
  fundingLines: [
    {
      id: "line",
      fundBookNo: "FUND-1",
      unallocatedAmount: 100,
      allocations: [
        { id: "draft", status: "draft" },
        { id: "confirmed", status: "confirmed" },
      ],
    },
  ],
};
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
vi.mock("../../../api/reimbursementLedger", () => ({
  useReimbursementClaims: () => ({ data: { items: [claim] } }),
  useSettlementObligations: () => ({
    data: {
      items: [{ id: "obligation", month: "2026-11", sourcePi: "费用负责人", iacuc: "IACUC-1", outstandingAmount: 100 }],
    },
  }),
  useReimbursementClaim: (id: string) => ({ data: id ? { item: claim } : undefined, refetch: api.refetch }),
  useCreateReimbursementAllocation: () => ({ mutateAsync: api.create }),
  useConfirmReimbursementAllocation: () => ({ mutateAsync: api.confirm }),
  useReverseReimbursementAllocation: () => ({ mutateAsync: api.reverse }),
}));
vi.mock("./LedgerListShared", () => ({ LedgerColumnTitle: () => null }));
vi.mock("../../../components/WorkspaceUi", () => ({ formatMoney: String }));
vi.mock("../../../components/ui", () => ({
  DataTable: ({
    columns,
    dataSource,
  }: {
    columns: Array<{ key: string; render?: (value: unknown, item: { id: string; status: string }) => ReactNode }>;
    dataSource: Array<{ id: string; status: string }>;
  }) => (
    <>
      {dataSource.map((item) => (
        <div key={item.id}>{columns.find((column) => column.key === "actions")?.render?.(undefined, item)}</div>
      ))}
    </>
  ),
}));
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({
    children,
    open,
    onOk,
    okText,
  }: {
    children: ReactNode;
    open: boolean;
    onOk: () => void;
    okText: string;
  }) =>
    open ? (
      <section role="dialog">
        {children}
        <button onClick={onOk}>{okText}</button>
      </section>
    ) : null,
}));
vi.mock("antd", async (load) => ({
  ...(await load<typeof Antd>()),
  Select: ({
    placeholder,
    value,
    options,
    onChange,
    disabled,
  }: {
    placeholder: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label={placeholder}
      value={value || ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
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
function openClaim() {
  render(<ReconciliationPanel user={user} onOpenClaim={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "请选择报销单" }), { target: { value: "claim" } });
}
function chooseAmount() {
  fireEvent.change(screen.getByRole("combobox", { name: "请选择经费本号" }), { target: { value: "line" } });
  fireEvent.change(screen.getByRole("combobox", { name: "请选择结算应收" }), { target: { value: "obligation" } });
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "25.5" } });
}

it("preserves allocation input when the write fails and does not report success", async () => {
  api.create.mockRejectedValueOnce(new Error("可核销余额已变化"));
  openClaim();
  chooseAmount();
  fireEvent.click(screen.getByRole("button", { name: "创建草稿" }));
  await screen.findByText("可核销余额已变化");
  expect(screen.getByRole("spinbutton")).toHaveValue(25.5);
  expect(api.create).toHaveBeenCalledWith({
    claimId: "claim",
    fundingLineId: "line",
    obligationId: "obligation",
    amount: 25.5,
  });
  expect(feedback.success).not.toHaveBeenCalled();
});

it("does not turn a completed allocation into a failed write when the following refresh fails", async () => {
  api.create.mockResolvedValueOnce({});
  api.refetch
    .mockResolvedValueOnce({ isError: true, error: new Error("读取超时") })
    .mockResolvedValueOnce({ isError: false });
  openClaim();
  chooseAmount();
  fireEvent.click(screen.getByRole("button", { name: "创建草稿" }));
  await screen.findByText("核销草稿已创建，但报销单详情刷新失败：读取超时");
  expect(feedback.success).toHaveBeenCalledWith("核销草稿已创建", "BX-001");
  fireEvent.click(screen.getByRole("button", { name: "重试读取详情" }));
  await waitFor(() => expect(api.refetch).toHaveBeenCalledTimes(2));
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(feedback.success).toHaveBeenCalledOnce();
});

it("keeps a reverse failure and its reason inside the confirmation modal", async () => {
  api.reverse.mockRejectedValueOnce(new Error("无撤销权限"));
  openClaim();
  fireEvent.click(screen.getByRole("button", { name: /撤\s*销/ }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "冲销误录" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "确认撤销" }));
  await within(dialog).findByText("无撤销权限");
  expect(within(dialog).getByRole("textbox")).toHaveValue("冲销误录");
  expect(api.reverse).toHaveBeenCalledWith({ id: "confirmed", reason: "冲销误录" });
  expect(feedback.success).not.toHaveBeenCalled();
});
