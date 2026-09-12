import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QuantitySheet } from "../../../api/contracts";
import { listAllQuantitySheets } from "../../../api/quantitySheets";
import { useQuantitySheetSelection } from "./useQuantitySheetSelection";

vi.mock("../../../api/quantitySheets", () => ({ listAllQuantitySheets: vi.fn() }));

const items = [{ id: "a" }, { id: "b" }] as QuantitySheet[];
const params = { limit: 10, offset: 0 };

function delayedList() {
  let resolve!: (items: QuantitySheet[]) => void;
  const promise = new Promise<QuantitySheet[]>((fulfill) => {
    resolve = fulfill;
  });
  vi.mocked(listAllQuantitySheets).mockReturnValueOnce(promise);
  return { resolve };
}

describe("saved quantity sheet selection", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("cancels an old select-all read without accepting its result after clearing the scope", async () => {
    const deferred = delayedList();
    const { result } = renderHook(useQuantitySheetSelection);
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    const signal = vi.mocked(listAllQuantitySheets).mock.calls[0][1];
    act(() => result.current.clear());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      deferred.resolve(items);
      await completion;
    });
    expect(result.current.selected).toEqual([]);
    expect(result.current.selectingAll).toBe(false);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("preserves a new manual selection when a cancelled select-all response arrives", async () => {
    const deferred = delayedList();
    const { result } = renderHook(useQuantitySheetSelection);
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.toggleAll(params);
      result.current.toggle("b", true);
    });
    await act(async () => {
      deferred.resolve(items);
      await completion;
    });
    expect(result.current.selected).toEqual(["b"]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("retains a completed selection across rerenders and clears it explicitly", async () => {
    vi.mocked(listAllQuantitySheets).mockResolvedValueOnce(items);
    const { result, rerender } = renderHook(useQuantitySheetSelection);
    await act(async () => result.current.toggleAll(params));
    rerender();
    expect(result.current.selected).toEqual(["a", "b"]);
    expect(result.current.allFilteredSelected).toBe(true);
    act(() => result.current.clear());
    expect(result.current.selected).toEqual([]);
  });

  it("prevents duplicate requests and lets a failed select-all request be retried", async () => {
    vi.mocked(listAllQuantitySheets).mockRejectedValueOnce(new Error("网络失败"));
    const { result } = renderHook(useQuantitySheetSelection);
    await act(async () => {
      await Promise.all([result.current.toggleAll(params), result.current.toggleAll(params)]);
    });
    expect(listAllQuantitySheets).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("网络失败");
    expect(result.current.allFilteredSelected).toBe(false);
    vi.mocked(listAllQuantitySheets).mockResolvedValueOnce(items);
    await act(async () => result.current.toggleAll(params));
    expect(result.current.error).toBe("");
    expect(result.current.selected).toEqual(["a", "b"]);
  });

  it("aborts the read on unmount", async () => {
    const deferred = delayedList();
    const { result, unmount } = renderHook(useQuantitySheetSelection);
    let completion!: Promise<void>;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    const signal = vi.mocked(listAllQuantitySheets).mock.calls[0][1];
    unmount();
    expect(signal?.aborted).toBe(true);
    deferred.resolve(items);
    await completion;
  });
});
