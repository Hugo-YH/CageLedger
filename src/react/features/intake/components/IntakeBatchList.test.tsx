import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TableProps } from "antd";
import { isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createIntakeDraft } from "../../../../domain/intake";
import type { IntakeBatchListItem, IntakeListParams } from "../../../api/contracts";
import { IntakeBatchList } from "./IntakeBatchList";

const counts = vi.hoisted(() => ({ tables: 0, cells: 0 }));
vi.mock("../../../components/ui", () => ({
  CommandBar: () => null,
  DataTable: ({ columns, dataSource }: TableProps<IntakeBatchListItem>) => {
    counts.tables += 1;
    return (
      <div>
        {dataSource?.map((item, row) => (
          <div key={item.id}>
            {columns?.map((column, index) => {
              if (!("render" in column) || !column.render) return null;
              counts.cells += 1;
              const cell = column.render(undefined, item, row);
              return row === 0 && isValidElement(cell) ? <span key={index}>{cell}</span> : null;
            })}
          </div>
        ))}
      </div>
    );
  },
}));
vi.mock("./IntakeSummaryExport", () => ({ IntakeSummaryExport: () => null }));
vi.mock("./IntakeStatistics", () => ({ IntakeStatistics: () => null }));
vi.mock("./ProjectPeopleCopyButton", () => ({
  ProjectPeopleCopyProvider: ({ children }: { children: React.ReactNode }) => children,
  ProjectPeopleCopyButton: () => null,
}));
vi.mock("../../quarantine/IntakeQuarantineStatus", () => ({ IntakeQuarantineStatus: () => null }));

const items = Array.from({ length: 100 }, (_, index) => ({
  ...createIntakeDraft("测试"),
  id: String(index),
  batchNo: `批次${index}`,
}));
const selectedItems: IntakeBatchListItem[] = [];
const params: IntakeListParams = { limit: 100, offset: 0 };
const filters: Record<string, string[]> = {};
const callbacks = () => ({
  onClearSelection: () => {},
  onToggleAll: () => {},
  onToggleItem: () => {},
  onSort: () => {},
  onFilter: () => {},
  onPrint: () => {},
  onMarkPrinted: () => {},
  onReceive: () => {},
  onEdit: () => {},
  onDelete: () => {},
  onPage: () => {},
  onPageSize: () => {},
});
const props = {
  total: 100,
  selectedItems,
  items,
  loading: false,
  selectingAll: false,
  allFilteredSelected: false,
  bulkNotice: "",
  bulkNoticeKind: "info" as const,
  markingPrinted: false,
  markingReceived: false,
  printDisabledReason: "",
  page: 1,
  pageSize: 100,
  params,
  filters,
};

describe("IntakeBatchList render isolation", () => {
  afterEach(cleanup);
  beforeEach(() => {
    counts.tables = 0;
    counts.cells = 0;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: () => {}, removeListener: () => {} });
  });
  it("skips unrelated parent updates and uses the latest committed callbacks", () => {
    const oldEdit = vi.fn();
    const newEdit = vi.fn();
    const { rerender } = render(<IntakeBatchList {...props} {...callbacks()} onEdit={oldEdit} />);
    const initial = { ...counts };
    rerender(<IntakeBatchList {...props} {...callbacks()} onEdit={newEdit} />);
    expect(counts.tables - initial.tables).toBe(0);
    expect(counts.cells - initial.cells).toBe(0);
    fireEvent.click(screen.getAllByRole("button", { name: /编\s*辑/ })[0]);
    expect(oldEdit).not.toHaveBeenCalled();
    expect(newEdit).toHaveBeenCalledWith(items[0]);
  });

  it("updates rows, selection and blocked controls when their inputs change", () => {
    const { rerender } = render(<IntakeBatchList {...props} {...callbacks()} />);
    const initial = { ...counts };
    const changedItems = [{ ...items[0], batchNo: "更新批次" }, ...items.slice(1)];
    rerender(<IntakeBatchList {...props} {...callbacks()} items={changedItems} selectedItems={[changedItems[0]]} />);
    expect(counts.tables - initial.tables).toBe(1);
    expect(screen.getByRole("checkbox", { name: "选择 更新批次" })).toBeChecked();
    rerender(
      <IntakeBatchList {...props} {...callbacks()} items={changedItems} selectedItems={[changedItems[0]]} loading />,
    );
    expect(screen.getByRole("checkbox", { name: "选择 更新批次" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /编\s*辑/ })[0]).toBeDisabled();
  });
});
