import { cleanup, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { RowActions } from "./RowActions";

vi.mock("antd", () => ({
  Button: ({ children, ...props }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Dropdown: ({
    children,
    menu,
  }: {
    children: ReactNode;
    menu?: {
      items?: Array<{ key: string; label?: ReactNode; disabled?: boolean }>;
      onClick?: ({ key }: { key: string }) => void;
    };
  }) => (
    <>
      {children}
      {menu?.items?.map((item) => (
        <button disabled={item.disabled} key={item.key} onClick={() => menu.onClick?.({ key: item.key })}>
          {item.label}
        </button>
      ))}
    </>
  ),
  Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Spin: () => <span>加载中</span>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps common row actions visible and routes low-frequency actions through the accessible menu", () => {
  const onDelete = vi.fn();
  render(
    <RowActions
      ariaLabel="统计表更多操作"
      lowFrequencyActions={[{ key: "delete", label: "删除", danger: true, onClick: onDelete }]}
    >
      <button>预览</button>
      <button>编辑</button>
    </RowActions>,
  );
  expect(screen.getByRole("button", { name: "预览" })).toBeVisible();
  expect(screen.getByRole("button", { name: "编辑" })).toBeVisible();
  expect(screen.getByRole("button", { name: "统计表更多操作" })).toBeVisible();
  screen.getByRole("button", { name: "删除" }).click();
  expect(onDelete).toHaveBeenCalledOnce();
});
