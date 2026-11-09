import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

it("keeps the empty-state title and explanation visible with the caller's recovery action", () => {
  const recover = vi.fn();
  render(
    <EmptyState
      title="暂无统计记录"
      detail="请选择其他月份查看。"
      action={<button onClick={recover}>选择月份</button>}
    />,
  );
  expect(screen.getByText("暂无统计记录")).toBeVisible();
  expect(screen.getByText("请选择其他月份查看。")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "选择月份" }));
  expect(recover).toHaveBeenCalledOnce();
});
