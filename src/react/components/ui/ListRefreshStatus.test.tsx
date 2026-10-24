import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ListRefreshStatus } from "./ListRefreshStatus";

vi.mock("antd", () => ({ Spin: () => <span aria-hidden="true" /> }));

describe("ListRefreshStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps a stable status slot without announcing a fast request or a cancelled timer", async () => {
    const { rerender } = render(<ListRefreshStatus active={false} />);
    const status = screen.getByRole("status");
    rerender(<ListRefreshStatus active />);
    await act(() => vi.advanceTimersByTime(150));
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveAttribute("data-active", "false");
    rerender(<ListRefreshStatus active={false} />);
    await act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toBeEmptyDOMElement();
  });

  it("explains a longer refresh and removes obsolete busy feedback immediately", async () => {
    const { rerender, unmount } = render(<ListRefreshStatus active />);
    await act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toHaveTextContent("正在更新，暂显示上次结果");
    expect(screen.getByRole("status")).toHaveAttribute("data-active", "true");
    rerender(<ListRefreshStatus active={false} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(<ListRefreshStatus active />);
    await act(() => vi.advanceTimersByTime(150));
    unmount();
    await act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
