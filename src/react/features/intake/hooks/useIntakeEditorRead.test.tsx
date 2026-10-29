import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IntakeBatch, IntakeBatchListItem } from "../../../api/contracts";
import { useIntakeEditorRead } from "./useIntakeEditorRead";

const state = vi.hoisted(() => ({
  ids: [] as string[],
  data: undefined as { item: IntakeBatch } | undefined,
  isFetching: true,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock("../../../api/intake", () => ({
  useIntakeBatchDetail: (id: string) => {
    state.ids.push(id);
    return state;
  },
}));
const summary = { id: "batch-a", updatedAt: "v1" } as IntakeBatchListItem;
const full = { ...summary, rawMessage: "完整原文", cards: [{ id: "card" }] } as IntakeBatch;

beforeEach(() => {
  state.ids = [];
  state.data = undefined;
  state.isFetching = true;
  state.isError = false;
  state.error = null;
  state.refetch.mockReset();
});
afterEach(cleanup);

it("opens immediately but only loads the complete detail after it resolves", () => {
  const onLoaded = vi.fn();
  const { result, rerender } = renderHook(() => useIntakeEditorRead(true, onLoaded, "batches"));
  act(() => result.current.begin(summary));
  expect(result.current.target).toEqual(summary);
  expect(onLoaded).not.toHaveBeenCalled();
  state.data = { item: full };
  state.isFetching = false;
  rerender();
  expect(onLoaded).toHaveBeenCalledExactlyOnceWith(full);
  expect(result.current.target).toBeNull();
});

it("does not apply late detail after closing or changing scope", () => {
  const onLoaded = vi.fn();
  const { result, rerender } = renderHook(({ scope }) => useIntakeEditorRead(true, onLoaded, scope), {
    initialProps: { scope: "batches" },
  });
  act(() => result.current.begin(summary));
  act(() => result.current.cancel());
  state.data = { item: full };
  state.isFetching = false;
  rerender({ scope: "batches" });
  expect(onLoaded).not.toHaveBeenCalled();
  state.isFetching = true;
  act(() => result.current.begin(summary));
  rerender({ scope: "entry" });
  expect(result.current.target).toBeNull();
  state.data = { item: full };
  state.isFetching = false;
  rerender({ scope: "entry" });
  expect(onLoaded).not.toHaveBeenCalled();
  rerender({ scope: "batches" });
  expect(onLoaded).not.toHaveBeenCalled();
  expect(result.current.target).toBeNull();
});

it("keeps the editor pending on detail error and retries without using the summary", () => {
  const onLoaded = vi.fn();
  const { result, rerender } = renderHook(() => useIntakeEditorRead(true, onLoaded, "batches"));
  act(() => result.current.begin(summary));
  state.isFetching = false;
  state.isError = true;
  state.error = new Error("详情失败");
  rerender();
  expect(result.current.target).toEqual(summary);
  expect(result.current.error?.message).toBe("详情失败");
  act(() => result.current.retry());
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(onLoaded).not.toHaveBeenCalled();
  state.isError = false;
  state.error = null;
  state.data = { item: full };
  rerender();
  expect(onLoaded).toHaveBeenCalledExactlyOnceWith(full);
});
