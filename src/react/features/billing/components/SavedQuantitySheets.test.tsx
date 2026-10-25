import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  useDeleteQuantitySheet: () => ({ isPending: false, mutateAsync: vi.fn() }),
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
  ActionButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  CommandBar: ({ primaryAction }: { primaryAction: ReactNode }) => <header>{primaryAction}</header>,
  DataTable: () => {
    state.tableRender();
    return <div data-testid="quantity-table" />;
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
