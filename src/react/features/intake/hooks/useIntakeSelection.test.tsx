import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIntakeDraft } from "../../../../domain/intake";
import type { IntakeBatch } from "../../../api/contracts";
import { listAllIntakeBatches } from "../../../api/intake";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { useIntakeSelection } from "./useIntakeSelection";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("antd", () => ({ App: { useApp: () => ({ message: { info } }) } }));
vi.mock("../../../api/intake", () => ({ listAllIntakeBatches: vi.fn() }));
const items = ["a", "b"].map((id) => ({ ...createIntakeDraft("测试"), id }));
const params = { limit: 10, offset: 0 };

function deferredList() {
  let resolve!: (items: IntakeBatch[]) => void;
  const promise = new Promise<IntakeBatch[]>((fulfill) => {
    resolve = fulfill;
  });
  vi.mocked(listAllIntakeBatches).mockReturnValueOnce(promise);
  return { resolve };
}

function useScopedSelection({ filter }: { filter: string; page: number; pageSize: number; sort: string }) {
  const selection = useIntakeSelection();
  useSelectionScope(filter, selection.clear, selection.selectedItems.length > 0 || selection.selectingAll);
  return selection;
}

describe("intake selection", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("preserves completed selection across page, size and sort changes and clears effective filters", () => {
    const props = { filter: "all", page: 1, pageSize: 10, sort: "intakeDate" };
    const { result, rerender } = renderHook(useScopedSelection, { initialProps: props });
    act(() => result.current.toggle(items[0], true));
    rerender({ ...props, page: 2, pageSize: 50, sort: "batchNo" });
    expect(result.current.selectedItems).toEqual([items[0]]);
    expect(info).not.toHaveBeenCalled();
    rerender({ ...props, filter: "printed" });
    expect(result.current.selectedItems).toEqual([]);
    expect(info).toHaveBeenCalledOnce();
  });

  it("cancels a pending all-results read and rejects its late response after scope changes", async () => {
    const deferred = deferredList();
    const props = { filter: "all", page: 1, pageSize: 10, sort: "intakeDate" };
    const { result, rerender } = renderHook(useScopedSelection, { initialProps: props });
    let completion: Promise<void> | undefined;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    const signal = vi.mocked(listAllIntakeBatches).mock.calls[0][1];
    rerender({ ...props, filter: "printed" });
    expect(signal?.aborted).toBe(true);
    expect(result.current.selectingAll).toBe(false);
    await act(async () => {
      deferred.resolve(items);
      await completion;
    });
    expect(result.current.selectedItems).toEqual([]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("does not overwrite manual selection with a pending all-results response", async () => {
    const deferred = deferredList();
    const { result } = renderHook(useIntakeSelection);
    let completion: Promise<void> | undefined;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    act(() => result.current.toggle(items[0], true));
    await act(async () => {
      deferred.resolve(items);
      await completion;
    });
    expect(result.current.selectedItems).toEqual([items[0]]);
  });

  it("can clear all-results progress and retry after a failure", async () => {
    vi.mocked(listAllIntakeBatches).mockRejectedValueOnce(new Error("读取失败"));
    const { result } = renderHook(useIntakeSelection);
    await act(async () => {
      await result.current.toggleAll(params);
    });
    expect(result.current.error).toBe("读取失败");
    vi.mocked(listAllIntakeBatches).mockResolvedValueOnce(items);
    await act(async () => {
      await result.current.toggleAll(params);
    });
    expect(result.current.selectedItems).toEqual(items);
    expect(result.current.error).toBe("");
    act(() => result.current.clear());
    expect(result.current.selectedItems).toEqual([]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("aborts all-results loading when the page unmounts", async () => {
    const deferred = deferredList();
    const { result, unmount } = renderHook(useIntakeSelection);
    let completion: Promise<void> | undefined;
    act(() => {
      completion = result.current.toggleAll(params);
    });
    const signal = vi.mocked(listAllIntakeBatches).mock.calls[0][1];
    unmount();
    expect(signal?.aborted).toBe(true);
    deferred.resolve(items);
    await completion;
  });
});
