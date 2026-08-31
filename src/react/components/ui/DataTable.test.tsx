import type { HTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableProps } from "antd";

import { DataTable } from "./DataTable";
import { loadStoredWidths, persistColumnWidths } from "./tableColumnWidths";

type Row = { id: string; name: string; count: number };
const rows: Row[] = [{ id: "row-1", name: "批次一", count: 10 }];
const columns: TableProps<Row>["columns"] = [
  { key: "name", dataIndex: "name", title: "批次", width: 140, sorter: true, fixed: false },
  { key: "count", dataIndex: "count", title: "数量", width: "120px", align: "right" },
  { key: "action", title: "操作", fixed: "end", render: () => "详情" },
];

describe("DataTable", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const computedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => computedStyle(element));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves numeric string and fixed widths, including a horizontal scroll budget", () => {
    const { container } = render(<DataTable columns={columns} dataSource={rows} rowKey="id" pagination={false} />);
    expect(screen.getByRole("slider", { name: "调整数量列宽" })).toHaveAttribute("aria-valuenow", "120");
    expect(screen.queryByRole("slider", { name: "调整操作列宽" })).not.toBeInTheDocument();
    expect(container.querySelector("table")).toHaveStyle({ width: "400px" });
    expect(container.querySelectorAll("col")[2]).toHaveStyle({ width: "140px" });
  });

  it("supports fixed:false and keyboard resizing without triggering sorting", () => {
    const onChange = vi.fn();
    render(<DataTable columns={columns} dataSource={rows} rowKey="id" pagination={false} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "调整批次列宽" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "156");
    fireEvent.keyDown(slider, { key: "Enter" });
    fireEvent.click(slider);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("columnheader", { name: "批次" }));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("reloads the correct preferences when the table identity changes", () => {
    persistColumnWidths("a", { name: 200 });
    persistColumnWidths("b", { name: 320 });
    const { rerender } = render(<DataTable columns={columns} dataSource={rows} rowKey="id" resizeKey="a" />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "调整批次列宽" }), { key: "ArrowRight" });
    rerender(<DataTable columns={columns} dataSource={rows} rowKey="id" resizeKey="b" />);
    expect(screen.getByRole("slider", { name: "调整批次列宽" })).toHaveAttribute("aria-valuenow", "320");
    expect(loadStoredWidths("a")).toEqual({ name: 216 });
    expect(loadStoredWidths("b")).toEqual({ name: 320 });
  });

  it("counts grouped leaves, ignores hidden columns and keeps relative widths", () => {
    const grouped: TableProps<Row>["columns"] = [
      {
        title: "数据",
        children: [
          { title: "批次", dataIndex: "name", width: 160 },
          { title: "数量", dataIndex: "count", width: 80 },
        ],
      },
      { title: "隐藏", hidden: true, width: 1000 },
    ];
    const { container, rerender } = render(
      <DataTable columns={grouped} dataSource={rows} rowKey="id" pagination={false} />,
    );
    expect(container.querySelector("table")).toHaveStyle({ width: "240px" });
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    rerender(
      <DataTable
        columns={[{ title: "批次", dataIndex: "name", width: "50%" }]}
        dataSource={rows}
        rowKey="id"
        pagination={false}
      />,
    );
    expect(container.querySelector("col")).toHaveStyle({ width: "50%" });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("preserves caller body components, size and selection", () => {
    function Body(props: HTMLAttributes<HTMLTableSectionElement>) {
      return <tbody {...props} data-testid="custom-body" />;
    }
    const onSelect = vi.fn();
    const { container } = render(
      <DataTable
        columns={columns}
        dataSource={rows}
        rowKey="id"
        pagination={false}
        size="small"
        components={{ body: { wrapper: Body } }}
        rowSelection={{ onChange: onSelect }}
      />,
    );
    expect(screen.getByTestId("custom-body")).toHaveTextContent("批次一");
    expect(container.querySelector(".ant-table-small")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onSelect).toHaveBeenCalledWith(["row-1"], rows, expect.objectContaining({ type: "single" }));
  });
});
