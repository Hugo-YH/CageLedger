import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConfigProvider, type TableProps } from "antd";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { IntakeBatchListItem, IntakeListParams } from "../../../../contracts/intake";
import { useIntakeFilterOptions } from "../../../api/intake";
import { IntakeBatchList } from "./IntakeBatchList";

const filterOptions = vi.hoisted(() => [
  { value: "(Z2025117)2026050808", label: "(Z2025117)2026050808", count: 1 },
  { value: "(Z2026026)2026042806", label: "(Z2026026)2026042806", count: 2 },
  { value: "（Z2025170）2026102902", label: "（Z2025170）2026102902", count: 3 },
]);
vi.mock("../../../api/intake", () => ({
  useIntakeFilterOptions: vi.fn(() => ({
    data: { items: filterOptions },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));
vi.mock("../../../components/ui", () => ({
  CommandBar: () => null,
  DataTable: ({ columns }: TableProps<IntakeBatchListItem>) => {
    const title = columns?.find((column) => column.key === "batchNo")?.title;
    return (
      <table>
        <thead>
          <tr>
            <th>{typeof title === "function" ? null : title}</th>
          </tr>
        </thead>
      </table>
    );
  },
}));
vi.mock("./IntakeSummaryExport", () => ({ IntakeSummaryExport: () => null }));
vi.mock("./IntakeStatistics", () => ({ IntakeStatistics: () => null }));
vi.mock("./ProjectPeopleCopyButton", () => ({
  ProjectPeopleCopyProvider: ({ children }: { children: ReactNode }) => children,
  ProjectPeopleCopyButton: () => null,
}));
vi.mock("../../quarantine/IntakeQuarantineStatus", () => ({ IntakeQuarantineStatus: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("searches batch numbers across bracket styles and applies the original complete server values", async () => {
  const onFilter = vi.fn();
  const params: IntakeListParams = { limit: 10, offset: 0 };
  render(
    <ConfigProvider button={{ autoInsertSpace: false }} theme={{ token: { motion: false } }}>
      <IntakeBatchList
        total={3}
        selectedItems={[]}
        items={[]}
        loading={false}
        selectingAll={false}
        allFilteredSelected={false}
        bulkNotice=""
        bulkNoticeKind="info"
        markingPrinted={false}
        markingReceived={false}
        printDisabledReason=""
        page={1}
        pageSize={10}
        params={params}
        filters={{}}
        onFilter={onFilter}
        onClearSelection={vi.fn()}
        onToggleAll={vi.fn()}
        onToggleItem={vi.fn()}
        onSort={vi.fn()}
        onPrint={vi.fn()}
        onMarkPrinted={vi.fn()}
        onReceive={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onPage={vi.fn()}
        onPageSize={vi.fn()}
      />
    </ConfigProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "筛选批次号" }));
  const panel = await screen.findByRole("group", { name: "筛选批次号选项" });
  expect(useIntakeFilterOptions).toHaveBeenLastCalledWith(params, "batchNo", true);
  for (const label of ["（Z2025117）2026050808", "（Z2026026）2026042806", "（Z2025170）2026102902"])
    await waitFor(() => expect(within(panel).getByText(label, { exact: true })).toBeVisible());
  expect(within(panel).queryByText("(Z2025117)2026050808", { exact: true })).not.toBeInTheDocument();
  expect(within(panel).queryByText("(Z2026026)2026042806", { exact: true })).not.toBeInTheDocument();
  const search = within(panel).getByRole("searchbox", { name: "搜索批次号筛选选项" });
  for (const [code, suffix] of [
    ["Z2025117", "2026050808"],
    ["Z2025170", "2026102902"],
  ]) {
    for (const query of [
      `（${code}）${suffix}`,
      `(${code})${suffix}`,
      `（${code})${suffix}`,
      `(${code}）${suffix}`,
      ` (${code.toLowerCase()}）${suffix} `,
      code,
      suffix,
    ]) {
      fireEvent.change(search, { target: { value: query } });
      expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
      expect(within(panel).getByText(`（${code}）${suffix}`, { exact: true })).toBeVisible();
    }
  }
  fireEvent.change(search, { target: { value: "（Z2025117)2026050809" } });
  expect(within(panel).queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "" } });
  for (const checkbox of within(panel).getAllByRole("checkbox")) fireEvent.click(checkbox);
  expect(onFilter).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole("button", { name: "应用" }));
  expect(onFilter).toHaveBeenCalledExactlyOnceWith("batchNo", [
    "(Z2025117)2026050808",
    "(Z2026026)2026042806",
    "（Z2025170）2026102902",
  ]);
  expect(filterOptions.map((option) => option.label)).toEqual([
    "(Z2025117)2026050808",
    "(Z2026026)2026042806",
    "（Z2025170）2026102902",
  ]);
});
