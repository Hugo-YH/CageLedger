import { ActionIcon } from "./ActionIcon";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  cloneElement,
  createElement,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, expect, it, vi } from "vitest";

import { CommandBar } from "./CommandBar";

vi.mock("antd", () => ({
  Button: ({
    children,
    icon,
    ...props
  }: { children: ReactNode; icon?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
  Dropdown: ({
    children,
    menu,
  }: {
    children: ReactNode;
    menu?: {
      items?: Array<{ key: string; label?: ReactNode; icon?: ReactNode; disabled?: boolean }>;
      onClick?: ({ key }: { key: string }) => void;
    };
  }) => (
    <>
      {children}
      {menu?.items?.map((item) => (
        <button disabled={item.disabled} key={item.key} onClick={() => menu.onClick?.({ key: item.key })}>
          {item.icon}
          {item.label}
        </button>
      ))}
    </>
  ),
  Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({
    children,
    content,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    content: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <>
      {cloneElement(children as ReactElement<{ onClick: () => void }>, { onClick: () => onOpenChange(!open) })}
      {open ? <div role="dialog">{content}</div> : null}
    </>
  ),
  Spin: () => <span data-testid="action-loading" aria-hidden="true" />,
  Typography: {
    Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Title: ({ children, level, className }: { children: ReactNode; level: number; className: string }) =>
      createElement(`h${level}`, { className }, children),
    Paragraph: ({ children, className }: { children: ReactNode; className: string }) => (
      <p className={className}>{children}</p>
    ),
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("exposes actionable, disabled and loading low-frequency actions with accessible trigger", () => {
  const onArchive = vi.fn();
  const onDisabled = vi.fn();
  render(
    <CommandBar
      lowFrequencyActions={[
        { icon: <ActionIcon name="save" />, key: "archive", label: "归档", onClick: onArchive, danger: true },
        { icon: <ActionIcon name="info" />, key: "disabled", label: "已禁用", disabled: true, onClick: onDisabled },
        { icon: <ActionIcon name="sync" />, key: "loading", label: "处理中", loading: true, onClick: onDisabled },
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: "工作区操作更多操作" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "归档" }).querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("button", { name: "已禁用" }).querySelector("svg")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "处理中" }).querySelector("svg")).toBeNull();
  expect(screen.getByTestId("action-loading")).toBeInTheDocument();
  screen.getByRole("button", { name: "归档" }).click();
  expect(onArchive).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "已禁用" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "处理中" })).toBeDisabled();
  expect(onDisabled).not.toHaveBeenCalled();
});

it("registers delayed actions, hands sticky ownership back, and restores scroll offsets when actions disappear", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 48,
    right: 400,
    width: 400,
    height: 48,
    toJSON: () => ({}),
  });
  const filters = <input aria-label="查询范围" />;
  const view = (outer: boolean, inner: boolean) => (
    <section
      aria-label="滚动区"
      style={{ overflowY: "auto", scrollPaddingTop: "12px", "--cl-workspace-toolbar-offset": "20px" } as CSSProperties}
    >
      <CommandBar sticky ariaLabel="页面操作" filters={filters} actions={outer && <button>页面保存</button>} />
      <section>
        <CommandBar sticky ariaLabel="编辑操作" actions={inner && <button>保存草稿</button>} />
      </section>
    </section>
  );
  const { rerender } = render(view(false, false));
  const owner = screen.getByRole("region", { name: "滚动区" });
  expect(screen.getByRole("textbox", { name: "查询范围" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "页面操作" })).not.toBeInTheDocument();
  expect(owner.style.scrollPaddingTop).toBe("12px");

  rerender(view(true, false));
  expect(screen.getByRole("group", { name: "页面操作" })).toHaveAttribute("data-sticky", "true");
  expect(parseFloat(owner.style.scrollPaddingTop)).toBeGreaterThan(12);
  rerender(view(true, true));
  expect(screen.getByRole("group", { name: "页面操作" })).toHaveAttribute("data-sticky", "false");
  expect(screen.getByRole("group", { name: "编辑操作" })).toHaveAttribute("data-sticky", "true");
  rerender(view(true, false));
  expect(screen.getByRole("group", { name: "页面操作" })).toHaveAttribute("data-sticky", "true");
  rerender(view(false, false));
  expect(owner.style.scrollPaddingTop).toBe("12px");
  expect(owner.style.getPropertyValue("--cl-workspace-toolbar-offset")).toBe("20px");
});

it("keeps the page title and actions together before static filters without remounting focused fields", () => {
  const onSave = vi.fn();
  const view = (title: string) => (
    <CommandBar
      title={title}
      description="当前工作范围"
      filters={<input aria-label="筛选" />}
      primaryAction={<button onClick={onSave}>保存</button>}
    />
  );
  const { rerender } = render(view("编辑记录"));
  const heading = screen.getByRole("heading", { name: "编辑记录", level: 2 });
  const bar = screen.getByRole("group", { name: "工作区操作" });
  expect(bar).toContainElement(heading);
  expect(bar).toContainElement(screen.getByRole("button", { name: "保存" }));
  const field = screen.getByRole("textbox", { name: "筛选" });
  expect(heading.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  field.focus();
  rerender(view("已保存记录"));
  expect(field).toHaveFocus();
  screen.getByRole("button", { name: "保存" }).click();
  expect(onSave).toHaveBeenCalledOnce();
});

it("renders a title-only area with section heading semantics", () => {
  render(<CommandBar title="原始资料" titleSize="section" />);
  expect(screen.getByRole("group", { name: "工作区操作" })).toContainElement(
    screen.getByRole("heading", { name: "原始资料", level: 3 }),
  );
});

it("shows a single extra action directly and keeps its disabled/loading behavior", () => {
  const onRefresh = vi.fn();
  const view = (loading: boolean) => (
    <CommandBar
      lowFrequencyActions={[
        { key: "refresh", label: "刷新", icon: <ActionIcon name="refresh" />, loading, onClick: onRefresh },
      ]}
    />
  );
  const { rerender } = render(view(false));
  expect(screen.queryByRole("button", { name: "工作区操作更多操作" })).not.toBeInTheDocument();
  screen.getByRole("button", { name: "刷新" }).click();
  expect(onRefresh).toHaveBeenCalledOnce();
  rerender(view(true));
  expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
  screen.getByRole("button", { name: "刷新" }).click();
  expect(onRefresh).toHaveBeenCalledOnce();
});

it("keeps descriptions behind a named help control and closes it with Escape", () => {
  render(<CommandBar title="运营工作台" description="当前工作范围" />);
  expect(screen.queryByText("当前工作范围")).not.toBeInTheDocument();
  const help = screen.getByRole("button", { name: "运营工作台说明" });
  fireEvent.click(help);
  expect(screen.getByText("当前工作范围")).toBeVisible();
  fireEvent.keyDown(help, { key: "Escape" });
  expect(screen.queryByText("当前工作范围")).not.toBeInTheDocument();
});
