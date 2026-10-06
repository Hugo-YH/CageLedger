import { ActionIcon } from "./ActionIcon";
import { cleanup, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { RowActions } from "./RowActions";

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
  Spin: () => <span data-testid="action-loading" aria-hidden="true" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps a single additional row action visible and text-only", () => {
  const onDelete = vi.fn();
  render(
    <RowActions
      ariaLabel="统计表更多操作"
      lowFrequencyActions={[
        { icon: <ActionIcon name="remove" />, key: "delete", label: "删除", danger: true, onClick: onDelete },
      ]}
    >
      <button>预览</button>
      <button>编辑</button>
    </RowActions>,
  );
  expect(screen.getByRole("button", { name: "预览" })).toBeVisible();
  expect(screen.getByRole("button", { name: "编辑" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "统计表更多操作" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除" }).querySelector("svg")).toBeNull();
  expect(screen.getByRole("button", { name: "预览" }).querySelector("svg")).toBeNull();
  screen.getByRole("button", { name: "删除" }).click();
  expect(onDelete).toHaveBeenCalledOnce();
});
