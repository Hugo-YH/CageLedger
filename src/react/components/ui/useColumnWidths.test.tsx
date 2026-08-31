import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadStoredWidths } from "./tableColumnWidths";
import { useColumnWidths } from "./useColumnWidths";

describe("useColumnWidths", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("does not write on mount and coalesces drag updates into one idle write", () => {
    const { result } = renderHook(() => useColumnWidths("intake"));
    expect(localStorage.length).toBe(0);
    act(() => result.current.resize("name", 180));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => result.current.resize("name", 240));
    expect(result.current.widths.name).toBe(240);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(localStorage.length).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(loadStoredWidths("intake")).toEqual({ name: 240 });
  });

  it("flushes the last resize when leaving the page before the debounce expires", () => {
    const { result, unmount } = renderHook(() => useColumnWidths("intake"));
    act(() => result.current.resize("name", 280));
    unmount();
    expect(loadStoredWidths("intake")).toEqual({ name: 280 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clamps user changes, ignores non-finite widths and keeps no-op state stable", () => {
    const { result } = renderHook(() => useColumnWidths());
    act(() => result.current.resize("name", Infinity));
    expect(result.current.widths).toEqual({});
    act(() => result.current.resize("name", -10));
    expect(result.current.widths.name).toBe(40);
    act(() => result.current.resize("name", 800));
    const previous = result.current.widths;
    expect(previous.name).toBe(640);
    act(() => result.current.resize("name", 640));
    expect(result.current.widths).toBe(previous);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(localStorage.length).toBe(0);
  });
});
