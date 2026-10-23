import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { memo, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { useQuantitySheetSelection } from "../features/billing/hooks/useQuantitySheetSelection";
import { useSelectionScope } from "./useSelectionScope";

const info = vi.hoisted(() => vi.fn());
vi.mock("antd", () => ({ App: { useApp: () => ({ message: { info } }) } }));

const LocalScope = memo(function LocalScope() {
  const [scope, setScope] = useState("all");
  const selection = useQuantitySheetSelection();
  useSelectionScope(scope, selection.clear, selection.selected.length > 0 || selection.selectingAll);
  return (
    <>
      <button onClick={() => selection.toggle("sheet-1", true)}>选择</button>
      <button onClick={() => setScope("filtered")}>筛选</button>
      <span data-testid="count">{selection.selected.length}</span>
    </>
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("uses the current locally selected state when a local filter clears selection", async () => {
  render(<LocalScope />);
  await act(async () => {
    fireEvent.click(screen.getByText("选择"));
    await Promise.resolve();
  });
  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(info).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("筛选"));
  expect(screen.getByTestId("count")).toHaveTextContent("0");
  expect(info).toHaveBeenCalledExactlyOnceWith("范围已变化，已清空选择");
  fireEvent.click(screen.getByText("选择"));
  expect(screen.getByTestId("count")).toHaveTextContent("1");
  expect(info).toHaveBeenCalledTimes(1);
});

it("does not announce a scope change when there was no selection", () => {
  render(<LocalScope />);
  fireEvent.click(screen.getByText("筛选"));
  expect(info).not.toHaveBeenCalled();
});
