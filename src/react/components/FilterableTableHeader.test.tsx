import { ConfigProvider } from "antd";
import { useState, type ReactElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterableColumnTitle, type FilterableColumnTitleProps } from "./FilterableTableHeader";

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

  it("keeps selection through failure and retry, applies each change immediately and closes without applying twice", async () => {
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
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["beta"]);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const done = within(panel).getByRole("button", { name: "完成" });
    fireEvent.click(done);
    fireEvent.click(done);
    expect(onFilter).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it("keeps bracket styles distinct when no search normalization is requested", async () => {
    renderFilter(
      <FilterableColumnTitle
        label="购买单位"
        values={[]}
        options={[
          { value: "cn", label: "供应商（分部）", count: 1 },
          { value: "en", label: "供应商(分部)", count: 1 },
        ]}
        onSort={vi.fn()}
        onFilter={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "筛选购买单位" }));
    const panel = await screen.findByRole("group", { name: "筛选购买单位选项" });
    fireEvent.change(within(panel).getByRole("searchbox"), { target: { value: "(分部)" } });
    expect(within(panel).getAllByRole("checkbox", { name: /供应商/ })).toHaveLength(1);
    await waitFor(() => expect(within(panel).getByText("供应商(分部)", { exact: true })).toBeVisible());
    expect(within(panel).queryByText("供应商（分部）", { exact: true })).not.toBeInTheDocument();
  });

  it("distinguishes a search miss and closes on Escape without reverting an applied selection", async () => {
    const onFilter = vi.fn();
    renderFilter(
      <ControlledFilter label="项目负责人" values={[]} options={options} onSort={vi.fn()} onFilter={onFilter} />,
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
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["alpha"]);
    fireEvent.click(trigger);
    expect(within(panel).getByRole("checkbox", { name: /示例负责人甲/ })).toBeChecked();
    expect(search).toHaveValue("");
  });

  it("immediately filters a whole year while preserving undetermined dates", async () => {
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
    fireEvent.click(within(panel).getByRole("checkbox", { name: "多选" }));
    fireEvent.click(within(panel).getByRole("checkbox", { name: /2026年/ }));
    await waitFor(() => expect(within(panel).getByRole("checkbox", { name: /2026年/ })).toBeChecked());
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["", "2026-10-28", "2026-10-29"]);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(panel).getByRole("button", { name: "完成" }));
    expect(onFilter).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it("shows half-selection and replaces the current dates with the newly checked month by default", async () => {
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
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["2026-11"]);
    fireEvent.click(within(panel).getByRole("button", { name: "完成" }));
    expect(onFilter).toHaveBeenCalledOnce();
  });
  it("replaces earlier search selections by default and appends across searches only in multi-select mode", async () => {
    const onFilter = vi.fn();
    renderFilter(
      <ControlledFilter label="负责人" values={[]} options={options} onSort={vi.fn()} onFilter={onFilter} />,
    );
    const trigger = screen.getByRole("button", { name: "筛选负责人" });
    fireEvent.click(trigger);
    const panel = await screen.findByRole("group", { name: "筛选负责人选项" });
    const search = within(panel).getByRole("searchbox");
    const multiple = within(panel).getByRole("checkbox", { name: "多选" });
    expect(multiple).not.toBeChecked();
    fireEvent.change(search, { target: { value: "甲" } });
    fireEvent.click(within(panel).getByRole("checkbox", { name: /示例负责人甲/ }));
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["alpha"]);
    fireEvent.click(within(panel).getByRole("button", { name: "完成" }));
    fireEvent.click(trigger);

    fireEvent.change(search, { target: { value: "乙" } });
    expect(onFilter).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel).getByRole("checkbox", { name: /示例负责人乙/ }));
    expect(onFilter).toHaveBeenLastCalledWith(["beta"]);

    fireEvent.click(multiple);
    expect(onFilter).toHaveBeenCalledTimes(2);
    fireEvent.change(search, { target: { value: "甲" } });
    expect(within(panel).getByRole("checkbox", { name: /示例负责人甲/ })).not.toBeChecked();
    fireEvent.click(within(panel).getByRole("checkbox", { name: /示例负责人甲/ }));
    expect(onFilter).toHaveBeenLastCalledWith(["beta", "alpha"]);
    fireEvent.click(within(panel).getByRole("button", { name: "完成" }));
    fireEvent.click(trigger);
    expect(multiple).toBeChecked();
    fireEvent.click(multiple);
    expect(onFilter).toHaveBeenCalledTimes(3);
    fireEvent.click(within(panel).getByRole("checkbox", { name: /示例负责人乙/ }));
    expect(onFilter).toHaveBeenLastCalledWith(["alpha"]);

    fireEvent.click(within(panel).getByRole("button", { name: "清空" }));
    expect(onFilter).toHaveBeenLastCalledWith([]);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(panel).getByRole("button", { name: "清空" }));
    expect(onFilter).toHaveBeenCalledTimes(5);
  });

  it("keeps cached candidates interactive during refresh and accepts an external reset", async () => {
    const onFilter = vi.fn();
    const props = { label: "负责人", values: ["alpha"], options, onSort: vi.fn(), onFilter };
    const { rerender } = renderFilter(<FilterableColumnTitle {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "筛选负责人" }));
    const panel = await screen.findByRole("group", { name: "筛选负责人选项" });
    rerender(<FilterableColumnTitle {...props} loading />);
    expect(within(panel).getByRole("checkbox", { name: /示例负责人甲/ })).toBeChecked();
    fireEvent.click(within(panel).getByRole("checkbox", { name: /示例负责人乙/ }));
    expect(onFilter).toHaveBeenCalledExactlyOnceWith(["beta"]);
    rerender(<FilterableColumnTitle {...props} values={[]} error="更新失败" />);
    expect(within(panel).getByRole("alert")).toHaveTextContent("更新失败");
    expect(within(panel).getByRole("checkbox", { name: /示例负责人乙/ })).not.toBeChecked();
    expect(within(panel).getByRole("checkbox", { name: /示例负责人甲/ })).not.toBeChecked();
    expect(onFilter).toHaveBeenCalledOnce();
  });
});

function ControlledFilter(props: FilterableColumnTitleProps) {
  const [values, setValues] = useState(props.values);
  return (
    <FilterableColumnTitle
      {...props}
      values={values}
      onFilter={(next) => {
        setValues(next);
        props.onFilter(next);
      }}
    />
  );
}
