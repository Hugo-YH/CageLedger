import { ConfigProvider } from "antd";
import type { ReactElement, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterableColumnTitle } from "./FilterableTableHeader";

const options = [
  { value: "alpha", label: "示例负责人甲", count: 1 },
  { value: "beta", label: "示例负责人乙", count: 2 },
];

function renderFilter(element: ReactElement) {
  return render(element, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ConfigProvider button={{ autoInsertSpace: false }} theme={{ token: { motion: false } }}>
        {children}
      </ConfigProvider>
    ),
  });
}

describe("FilterableColumnTitle feedback and keyboard", () => {
  beforeEach(() => {
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

  it("keeps the pending selection through failure and retry, then applies once with focus restored", async () => {
    const onRetry = vi.fn();
    const onFilter = vi.fn();
    const props = { label: "项目负责人", values: ["alpha"], options, onSort: vi.fn(), onFilter, onRetry };
    const { rerender } = renderFilter(<FilterableColumnTitle {...props} options={[]} error="暂时不可用" />);
    const trigger = screen.getByRole("button", { name: "筛选项目负责人" });
    fireEvent.click(trigger);
    const panel = await screen.findByRole("group", { name: "筛选项目负责人选项" });
    expect(within(panel).getByRole("alert")).toHaveTextContent("暂时不可用");
    fireEvent.click(within(panel).getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onFilter).not.toHaveBeenCalled();
    rerender(<FilterableColumnTitle {...props} options={[]} loading />);
    expect(panel).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(screen.getByRole("status", { name: "项目负责人筛选选项正在加载" })).toBeVisible());
    rerender(<FilterableColumnTitle {...props} />);
    expect(within(panel).getByRole("checkbox", { name: /示例负责人甲/ })).toBeChecked();
    fireEvent.click(within(panel).getByRole("checkbox", { name: /示例负责人乙/ }));
    const apply = within(panel).getByRole("button", { name: "应用" });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["alpha", "beta"]);
    expect(trigger).toHaveFocus();
  });

  it("distinguishes a search miss and discards unconfirmed edits on Escape", async () => {
    const onFilter = vi.fn();
    renderFilter(
      <FilterableColumnTitle label="项目负责人" values={[]} options={options} onSort={vi.fn()} onFilter={onFilter} />,
    );
    const trigger = screen.getByRole("button", { name: "筛选项目负责人" });
    fireEvent.click(trigger);
    const panel = await screen.findByRole("group", { name: "筛选项目负责人选项" });
    fireEvent.click(within(panel).getByRole("checkbox", { name: /示例负责人甲/ }));
    const search = within(panel).getByRole("searchbox", { name: "搜索项目负责人筛选选项" });
    fireEvent.change(search, { target: { value: "不存在" } });
    expect(within(panel).getByRole("status")).toHaveTextContent("没有匹配的筛选项");
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).toHaveFocus();
    expect(onFilter).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(within(panel).getByRole("checkbox", { name: /示例负责人甲/ })).not.toBeChecked();
    expect(search).toHaveValue("");
  });

  it("checks a whole year, preserves pending dates and only applies on confirmation", async () => {
    const onFilter = vi.fn();
    renderFilter(
      <FilterableColumnTitle
        label="接收日期"
        dateHierarchy="day"
        values={[""]}
        options={["2026-10-28", "2026-10-29", "2025-12-31", ""].map((value) => ({
          value,
          label: value || "待定",
          count: 1,
        }))}
        onSort={vi.fn()}
        onFilter={onFilter}
      />,
    );
    const trigger = screen.getByRole("button", { name: "筛选接收日期" });
    fireEvent.click(trigger);
    const panel = await screen.findByRole("group", { name: "筛选接收日期选项" });
    expect(within(panel).queryByText("10月")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("checkbox", { name: /2026年/ }));
    await waitFor(() => expect(within(panel).getByRole("checkbox", { name: /2026年/ })).toBeChecked());
    expect(onFilter).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "应用" }));
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["", "2026-10-28", "2026-10-29"]);
    expect(trigger).toHaveFocus();
  });

  it("searches and selects a month with half-selection feedback, without losing a hidden year", async () => {
    const onFilter = vi.fn();
    renderFilter(
      <FilterableColumnTitle
        label="结算月份"
        dateHierarchy="month"
        values={["2025-12", "2026-10"]}
        options={["2026-10", "2026-11", "2025-12"].map((value) => ({ value, label: value, count: 2 }))}
        onSort={vi.fn()}
        onFilter={onFilter}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "筛选结算月份" }));
    const panel = await screen.findByRole("group", { name: "筛选结算月份选项" });
    expect(within(panel).getByRole("checkbox", { name: /2026年/ })).toHaveAttribute("aria-checked", "mixed");
    fireEvent.change(within(panel).getByRole("searchbox"), { target: { value: "2026年11月" } });
    fireEvent.click(await within(panel).findByRole("checkbox", { name: /11月/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "应用" }));
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["2025-12", "2026-10", "2026-11"]);
  });
});
