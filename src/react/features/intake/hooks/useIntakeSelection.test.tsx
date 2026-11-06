import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIntakeDraft } from "../../../../domain/intake";
import type { IntakeBatchListItem } from "../../../api/contracts";
import { listAllIntakeBatchSummaries } from "../../../api/intake";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { useIntakeSelection } from "./useIntakeSelection";
import { intakeBatchSummary } from "../intakeBatchSummary";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("antd", () => ({ App: { useApp: () => ({ message: { info } }) } }));
vi.mock("../../../api/intake", () => ({ listAllIntakeBatchSummaries: vi.fn() }));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => ({ message: { info } }) }));
const items = ["a", "b"].map((id) => intakeBatchSummary({ ...createIntakeDraft("测试"), id }));
const params = { limit: 10, offset: 0 };

function deferredList() {
  let resolve!: (items: IntakeBatchListItem[]) => void;
  const promise = new Promise<IntakeBatchListItem[]>((fulfill) => {
    resolve = fulfill;
  });
  vi.mocked(listAllIntakeBatchSummaries).mockReturnValueOnce(promise);
  return { resolve };
}

function useScopedSelection({ filter }: { filter: string; page: number; pageSize: number; sort: string }) {
  const selection = useIntakeSelection();
  useSelectionScope(filter, selection.clear, selection.selectedItems.length > 0 || selection.selectingAll);
  return selection;
}

describe("intake selection", () => {
  it("projects complete write responses on every selection entry without losing action or quarantine fields", async () => {
    const full = {
      ...createIntakeDraft("测试"),
      id: "full",
      rawMessage: "large original",
      updatedAt: "v1",
      cards: [{ id: "card", index: 1, label: "1", qrId: "Q001", suggestedQuantity: "5" }],
      recognition: { extractedText: "large evidence", fieldSources: {}, warnings: [] },
      quarantineStatus: "检疫中" as const,
      quarantineBatches: [{ id: "quarantine", name: "检疫批", completedAt: "" }],
      batchNumberInfo: { status: "parsed" as const, iacuc: "Z1", approvalDate: "2026-10-01", sequence: "01" },
    };
    const before = structuredClone(full);
    const { result } = renderHook(useIntakeSelection);
    act(() => result.current.toggle(full, true));
    const assertSummary = () => {
      const selected = result.current.selectedItems[0];
      expect(selected).toMatchObject({
        id: "full",
        updatedAt: expect.any(String),
        quarantineStatus: "检疫中",
        quarantineBatches: full.quarantineBatches,
        batchNumberInfo: full.batchNumberInfo,
      });
      for (const key of ["cards", "rawMessage", "recognition", "receipts"]) expect(selected).not.toHaveProperty(key);
    };
    assertSummary();
    act(() => result.current.update([{ ...full, updatedAt: "v2", status: "received" }]));
    assertSummary();
    expect(result.current.selectedItems[0]).toMatchObject({ updatedAt: "v2", status: "received" });
    act(() => result.current.clear());
    vi.mocked(listAllIntakeBatchSummaries).mockResolvedValueOnce([full]);
    await act(() => result.current.toggleAll(params));
    assertSummary();
    expect(full).toEqual(before);
  });
  it("keeps selection while reflecting saved purpose and receipt status", () => {
    const { result } = renderHook(useIntakeSelection);
    act(() => {
      result.current.toggle(items[0], true);
      result.current.toggle(items[1], true);
    });
    const updated = { ...items[0], intakePurpose: "direct_sampling" as const, status: "received" as const };
    act(() => result.current.update([updated, { ...items[1], id: "not-selected" }]));
    expect(result.current.selectedItems).toEqual([updated, items[1]]);
  });
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
    const signal = vi.mocked(listAllIntakeBatchSummaries).mock.calls[0][1];
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
    vi.mocked(listAllIntakeBatchSummaries).mockRejectedValueOnce(new Error("读取失败"));
    const { result } = renderHook(useIntakeSelection);
    await act(async () => {
      await result.current.toggleAll(params);
    });
    expect(result.current.error).toBe("读取失败");
    vi.mocked(listAllIntakeBatchSummaries).mockResolvedValueOnce(items);
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
    const signal = vi.mocked(listAllIntakeBatchSummaries).mock.calls[0][1];
    unmount();
    expect(signal?.aborted).toBe(true);
    deferred.resolve(items);
    await completion;
  });
});
