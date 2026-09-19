import { cleanup, render, screen } from "@testing-library/react";
import type { CSSProperties, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { CommandBar } from "./CommandBar";

vi.mock("antd", () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Typography: { Text: ({ children }: { children: ReactNode }) => <span>{children}</span> },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
