import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingWorkflow } from "../../../api/workflows";
import type { SessionUser } from "../../../api/contracts";
import { BillingWorkflowTable } from "./BillingWorkflowTable";
import { WorkflowLockContext } from "./workflowLockContext";

const tableRender = vi.hoisted(() => vi.fn());
vi.mock("../../../components/ui", () => ({
  DataTable: ({
    columns,
    dataSource,
  }: {
    columns: Array<{
      key: string;
      title: ReactNode;
      dataIndex?: keyof BillingWorkflow;
      render?: (value: unknown, item: BillingWorkflow) => ReactNode;
    }>;
    dataSource: BillingWorkflow[];
  }) => {
    tableRender();
    return (
      <div>
        {columns.map((column) => (
          <div key={column.key}>{column.title}</div>
        ))}
        {dataSource.map((item) => (
          <section key={item.id} aria-label={item.id}>
            {columns.map((column) => (
              <div key={column.key}>
                {column.render ? column.render(undefined, item) : String(item[column.dataIndex!] ?? "")}
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  },
}));
vi.mock("./WorkflowColumnTitle", () => ({
  WorkflowColumnTitle: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("../../../components/BillingTags", () => ({ FeeTypeTag: () => null, ReimbursementReturnTag: () => null }));
vi.mock("antd", () => ({
  Button: (
    props: ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      danger?: boolean;
      color?: string;
      variant?: string;
    },
  ) => (
    <button
      type="button"
      aria-label={props["aria-label"]}
      disabled={props.disabled}
      onClick={props.onClick}
      data-loading={Boolean(props.loading)}
    >
      {props.children}
    </button>
  ),
  Checkbox: (props: ComponentProps<"input">) => <input {...props} type="checkbox" />,
  Popconfirm: ({ children, onConfirm, okText }: { children: ReactNode; onConfirm: () => void; okText: string }) => (
    <div>
      {children}
      <button onClick={onConfirm}>确认{okText}</button>
    </div>
  ),
  Empty: () => null,
  Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Typography: {
    Paragraph: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  },
}));

const user = { id: "operator", role: "admin", billingLockAllowed: true } as SessionUser;
const items = ["one", "two"].map(
  (id) =>
    ({
      id,
      pi: id,
      month: "2026-10",
      iacucs: [],
      workflowStatus: "statement_sent",
      totalAmount: 100,
    }) as unknown as BillingWorkflow,
);
function tableProps(): ComponentProps<typeof BillingWorkflowTable> {
  return {
    user,
    items,
    refreshing: false,
    density: "middle",
    filters: {},
    selectedLockable: [],
    allLockableSelected: false,
    hasLockableItems: true,
    onToggleLockable: vi.fn(),
    onToggleAllLockable: vi.fn(),
    onSort: vi.fn(),
    onFilter: vi.fn(),
    onRegister: vi.fn(),
    onDetail: vi.fn(),
    onRevoke: vi.fn(),
  };
}

describe("workflow table interaction isolation", () => {
  beforeEach(() => tableRender.mockClear());
  afterEach(cleanup);

  it("updates lock and selection controls without rendering the table again", () => {
    const props = tableProps();
    const onAdvance = vi.fn();
    const view = render(
      <WorkflowLockContext.Provider value={{ pending: false, activeId: "", onAdvance }}>
        <BillingWorkflowTable {...props} />
      </WorkflowLockContext.Provider>,
    );
    const renders = tableRender.mock.calls.length;
    view.rerender(
      <WorkflowLockContext.Provider value={{ pending: true, activeId: "one", onAdvance }}>
        <BillingWorkflowTable {...props} />
      </WorkflowLockContext.Provider>,
    );
    expect(tableRender).toHaveBeenCalledTimes(renders);
    const first = within(screen.getByRole("region", { name: "one" }));
    const second = within(screen.getByRole("region", { name: "two" }));
    expect(first.getByRole("button", { name: /^锁定$/ })).toHaveAttribute("data-loading", "true");
    expect(second.getByRole("button", { name: /^锁定$/ })).toHaveAttribute("data-loading", "false");
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: /^锁定$/ })) expect(button).toBeDisabled();
    view.rerender(
      <WorkflowLockContext.Provider value={{ pending: false, activeId: "", onAdvance }}>
        <BillingWorkflowTable {...props} selectedLockable={["two"]} />
      </WorkflowLockContext.Provider>,
    );
    expect(second.getByRole("checkbox")).toBeChecked();
    expect(first.getByRole("button", { name: /^锁定$/ })).toBeEnabled();
  });

  it.each([
    { workflowStatus: "statement_sent", expected: "statement_locked" },
    { workflowStatus: "statement_archived", expected: "statement_locked" },
    { workflowStatus: "statement_locked", signedStatementReturned: true, expected: "statement_archived" },
    {
      workflowStatus: "statement_locked",
      lockedFromStatus: "statement_sent",
      signedStatementReturned: true,
      expected: "statement_sent",
    },
    { workflowStatus: "statement_locked", unlockStatus: "statement_archived", expected: "statement_archived" },
  ])("preserves the state transition for $workflowStatus to $expected", (state) => {
    const onAdvance = vi.fn();
    const item = { ...items[0], ...state } as BillingWorkflow;
    render(
      <WorkflowLockContext.Provider value={{ pending: false, activeId: "", onAdvance }}>
        <BillingWorkflowTable {...tableProps()} items={[item]} />
      </WorkflowLockContext.Provider>,
    );
    const action = state.workflowStatus === "statement_locked" ? "解锁" : "锁定";
    fireEvent.click(screen.getByRole("button", { name: `确认${action}` }));
    expect(onAdvance).toHaveBeenCalledExactlyOnceWith({
      workflowId: item.id,
      toStatus: state.expected,
      note: `${action}结算流程`,
    });
  });

  it("keeps unauthorized lock and withdrawal controls absent", () => {
    render(
      <WorkflowLockContext.Provider value={{ pending: false, activeId: "", onAdvance: vi.fn() }}>
        <BillingWorkflowTable
          {...tableProps()}
          user={{ ...user, role: "room_admin", billingLockAllowed: false }}
          items={[{ ...items[0], canWithdraw: false }]}
        />
      </WorkflowLockContext.Provider>,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^锁定$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤回" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登记" })).toBeEnabled();
  });
});
