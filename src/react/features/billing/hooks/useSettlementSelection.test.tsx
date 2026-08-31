import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listAllSettlementCandidates } from "../../../api/billing";
import type { SettlementCandidate } from "../../../api/contracts";
import { useSettlementSelection } from "./useSettlementSelection";

vi.mock("../../../api/billing", () => ({ listAllSettlementCandidates: vi.fn() }));
const items: SettlementCandidate[] = ["a", "b"].map((id) => ({
  id,
  month: "2026-08",
  pi: id,
  iacucs: [],
  manager: "",
  totalAmount: 10,
}));
const params = { limit: 10, offset: 0 };

function delayedList() {
  let resolve!: (items: SettlementCandidate[]) => void;
  const promise = new Promise<SettlementCandidate[]>((fulfill) => {
    resolve = fulfill;
  });
  vi.mocked(listAllSettlementCandidates).mockReturnValueOnce(promise);
  return { resolve };
}

describe("settlement selection", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("keeps the user's manual selection when an old select-all response arrives", async () => {
    const deferred = delayedList();
    const { result } = renderHook(useSettlementSelection);
    let completion: Promise<void> | undefined;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    const signal = vi.mocked(listAllSettlementCandidates).mock.calls[0][1];
    act(() => {
      result.current.toggle(items[0], true);
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      deferred.resolve(items);
      await completion;
    });
    expect(result.current.selectedCandidates).toEqual([items[0]]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("clears pending selection on a filter change without accepting its late result", async () => {
    const deferred = delayedList();
    const { result } = renderHook(useSettlementSelection);
    let completion: Promise<void> | undefined;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    act(() => {
      result.current.clear();
    });
    await act(async () => {
      deferred.resolve(items);
      await completion;
    });
    expect(result.current.selectedCandidates).toEqual([]);
    expect(result.current.selectingAll).toBe(false);
  });

  it("does not start a second request on synchronous repeated clicks", async () => {
    const deferred = delayedList();
    const { result } = renderHook(useSettlementSelection);
    let completion: Promise<void> | undefined;
    act(() => {
      completion = result.current.toggleAll(params);
      void result.current.toggleAll(params);
    });
    expect(listAllSettlementCandidates).toHaveBeenCalledTimes(1);
    await act(async () => {
      deferred.resolve(items);
      await completion;
    });
  });

  it("reports failure, allows retry, and only selects calculable candidates", async () => {
    vi.mocked(listAllSettlementCandidates).mockRejectedValueOnce(new Error("网络失败"));
    const { result } = renderHook(useSettlementSelection);
    await act(async () => {
      await result.current.toggleAll(params);
    });
    expect(result.current.error).toBe("网络失败");
    expect(result.current.selectingAll).toBe(false);
    vi.mocked(listAllSettlementCandidates).mockResolvedValueOnce([items[0], { ...items[1], totalAmount: null }]);
    await act(async () => {
      await result.current.toggleAll(params);
    });
    expect(result.current.error).toBe("");
    expect(result.current.selectedCandidates).toEqual([items[0]]);
  });

  it("keeps completed select-all across pagination and removes only successful writes", async () => {
    vi.mocked(listAllSettlementCandidates).mockResolvedValueOnce(items);
    const { result } = renderHook(useSettlementSelection);
    await act(async () => {
      await result.current.toggleAll(params);
    });
    act(() => {
      result.current.cancelPending();
    });
    expect(result.current.allFilteredSelected).toBe(true);
    act(() => {
      result.current.removeCompleted(new Set([items[0].id]));
    });
    expect(result.current.selectedCandidates).toEqual([items[1]]);
  });

  it("aborts the read on unmount", async () => {
    const deferred = delayedList();
    const { result, unmount } = renderHook(useSettlementSelection);
    let completion: Promise<void> | undefined;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    const signal = vi.mocked(listAllSettlementCandidates).mock.calls[0][1];
    unmount();
    expect(signal?.aborted).toBe(true);
    deferred.resolve(items);
    await completion;
  });
});
