import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuantitySheet } from "../../../api/contracts";
import { SavedQuantitySheets } from "./SavedQuantitySheets";

const state = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const pdf = {
    value: { exportPdf: vi.fn(), isExporting: false, job: null as null | { completed: number; total: number } },
    listeners,
  };
  return {
    list: {
      data: { items: [{ id: "sheet-1", iacuc: "Z2026001" }] as QuantitySheet[], page: { total: 1 } },
      isFetching: false,
      isPending: false,
    },
    iacucExpiry: { data: { items: [] as Array<{ iacuc: string; projectEndDate: string }> } },
    pdf,
    selection: {
      allFilteredSelected: false,
      clear: vi.fn(),
      error: "",
      selected: ["sheet-1"],
      selectingAll: false,
      toggle: vi.fn(),
      toggleAll: vi.fn(),
    },
    tableRender: vi.fn(),
    setPdf(next: typeof pdf.value) {
      pdf.value = next;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("antd", () => ({
  Alert: ({ title }: { title: ReactNode }) => <div role="status">{title}</div>,
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Checkbox: () => null,
  Flex: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pagination: () => null,
  Space: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Typography: { Text: ({ children }: { children: ReactNode }) => <span>{children}</span> },
}));

vi.mock("../../../api/quantitySheets", () => ({
  fetchQuantitySheetsForPrint: vi.fn(),
  useDeleteQuantitySheet: () => ({ isPending: false, mutateAsync: removeMock }),
  useQuantityFilterOptions: () => ({ data: { items: [] }, isFetching: false }),
  useQuantitySheetDetail: () => ({ data: undefined, isPending: false }),
  useQuantitySheets: () => state.list,
}));
vi.mock("../../../api/iacuc", () => ({ useIacucExpiry: () => state.iacucExpiry }));
vi.mock("../hooks/useQuantitySheetSelection", () => ({ useQuantitySheetSelection: () => state.selection }));
vi.mock("../../../hooks/useSelectionScope", () => ({ useSelectionScope: vi.fn() }));
vi.mock("../hooks/usePdfExport", async () => {
  const React = await import("react");
  return {
    usePdfExport: () =>
      React.useSyncExternalStore(
        (listener) => {
          state.pdf.listeners.add(listener);
          return () => state.pdf.listeners.delete(listener);
        },
        () => state.pdf.value,
      ),
  };
});
vi.mock("../../../components/ui", () => ({
  ActionButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  CommandBar: ({ primaryAction }: { primaryAction: ReactNode }) => <header>{primaryAction}</header>,
  DataTable: ({
    columns,
    dataSource,
  }: {
    columns: Array<{ key?: string; render?: (value: unknown, item: QuantitySheet, index: number) => ReactNode }>;
    dataSource: QuantitySheet[];
  }) => {
    state.tableRender();
    const actions = columns.find((column) => column.key === "actions");
    return (
      <div data-testid="quantity-table">
        {dataSource.map((item, index) => (
          <section key={item.id} aria-label={item.id}>
            {actions?.render?.(null, item, index)}
          </section>
        ))}
      </div>
    );
  },
  ModalPresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SavedQuantitySheets PDF progress", () => {
  beforeEach(() => {
    state.tableRender.mockReset();
    state.setPdf({ exportPdf: vi.fn(), isExporting: false, job: null });
  });
  afterEach(cleanup);

  it("updates the export feedback without rerendering the saved DataTable", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SavedQuantitySheets onEdit={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(state.tableRender).toHaveBeenCalledOnce();

    act(() => state.setPdf({ exportPdf: vi.fn(), isExporting: true, job: { completed: 1, total: 2 } }));
    expect(screen.getByText("正在导出 1/2")).toBeInTheDocument();
    expect(state.tableRender).toHaveBeenCalledOnce();
  });

  it("keeps the saved DataTable out of a parent draft update", () => {
    const onEdit = vi.fn();
    function DraftHarness() {
      const [draft, setDraft] = useState("");
      return (
        <>
          <input aria-label="编辑字段" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <SavedQuantitySheets onEdit={onEdit} />
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DraftHarness />
      </QueryClientProvider>,
    );
    expect(state.tableRender).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole("textbox", { name: "编辑字段" }), { target: { value: "新值" } });
    expect(state.tableRender).toHaveBeenCalledOnce();
  });
});

const operationFeedback = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  message: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => operationFeedback }));

const removeMock = vi.hoisted(() => vi.fn());
vi.mock("../../../components/ui/Modal", () => ({
  Modal: ({
    open,
    title,
    children,
    footer,
    onCancel,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    footer: ReactNode;
    onCancel: () => void;
  }) =>
    open ? (
      <section role="dialog" aria-label={title}>
        {children}
        {footer}
        <button onClick={onCancel}>关闭确认</button>
      </section>
    ) : null,
}));

it.each(["resolve", "reject"] as const)(
  "ignores an old deletion's %s after another confirmation opens",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    removeMock.mockReturnValueOnce(
      new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      }),
    );
    state.list.data.items = [
      { id: "sheet-A", iacuc: "A" },
      { id: "sheet-B", iacuc: "B" },
    ] as QuantitySheet[];
    operationFeedback.success.mockClear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SavedQuantitySheets onEdit={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(within(screen.getByRole("region", { name: "sheet-A" })).getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(removeMock).toHaveBeenLastCalledWith("sheet-A");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(within(screen.getByRole("region", { name: "sheet-B" })).getByRole("button", { name: "删除" }));
    await act(async () => {
      if (outcome === "resolve") resolve();
      else reject(new Error("A删除失败"));
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog", { name: "删除数量统计表" })).toBeInTheDocument();
    expect(screen.queryByText("A删除失败")).not.toBeInTheDocument();
    expect(operationFeedback.success).not.toHaveBeenCalled();
    cleanup();
  },
);
