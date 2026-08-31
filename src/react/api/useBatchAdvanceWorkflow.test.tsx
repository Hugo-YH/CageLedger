import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import { useBatchAdvanceWorkflow } from "./useBatchAdvanceWorkflow";
import { useAdvanceWorkflow } from "./workflows";

vi.mock("./client", () => ({ requestJson: vi.fn() }));

const payloads = ["workflow-1", "workflow-2", "workflow-3"].map((workflowId) => ({
  workflowId,
  toStatus: "statement_locked",
  note: "批量锁定结算流程",
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidate };
}

describe("workflow batch refresh", () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("locks synchronously, keeps sequential writes and refreshes each dependent root once", async () => {
    const first = deferred<Record<string, unknown>>();
    vi.mocked(requestJson).mockReturnValueOnce(first.promise);
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useBatchAdvanceWorkflow, { wrapper });
    let completion: Promise<unknown> | undefined;
    act(() => {
      completion = result.current.run(payloads);
      expect(result.current.run(payloads)).toBe(completion);
    });
    await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      first.resolve({});
      await completion;
    });
    expect(requestJson).toHaveBeenCalledTimes(3);
    payloads.forEach((payload, index) => {
      expect(requestJson).toHaveBeenNthCalledWith(index + 1, "/api/billing-workflows/advance", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    });
    expect(invalidate.mock.calls).toEqual([
      [{ queryKey: queryKeys.reimbursementRoot }],
      [{ queryKey: queryKeys.settlementCandidatesRoot }],
      [{ queryKey: queryKeys.workflowsRoot }],
    ]);
    expect(result.current.completed).toBe(3);
  });

  it("continues after a partial failure and returns its identity and message", async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("权限不足"));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useBatchAdvanceWorkflow, { wrapper });
    await act(async () => {
      expect(await result.current.run(payloads)).toEqual({
        completed: [payloads[0], payloads[2]],
        failures: [{ item: payloads[1], message: "权限不足" }],
      });
    });
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("reconciles once even if every response fails, without retrying writes", async () => {
    vi.mocked(requestJson).mockRejectedValue(new Error("连接中断"));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useBatchAdvanceWorkflow, { wrapper });
    await act(async () => {
      expect((await result.current.run(payloads)).failures).toHaveLength(3);
    });
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("retains its lock until the final refresh completes", async () => {
    const refresh = deferred<void>();
    const { wrapper, invalidate } = setup();
    invalidate.mockReturnValue(refresh.promise);
    const { result } = renderHook(useBatchAdvanceWorkflow, { wrapper });
    let completion: Promise<unknown> | undefined;
    act(() => {
      completion = result.current.run(payloads);
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
    expect(result.current.isPending).toBe(true);
    expect(result.current.run(payloads)).toBe(completion);
    await act(async () => {
      refresh.resolve();
      await completion;
    });
    await act(async () => {
      await result.current.run(payloads.slice(0, 1));
    });
    expect(requestJson).toHaveBeenCalledTimes(4);
  });

  it("finishes writes and refreshes the cache after the page unmounts", async () => {
    const first = deferred<Record<string, unknown>>();
    vi.mocked(requestJson).mockReturnValueOnce(first.promise);
    const { wrapper, invalidate } = setup();
    const { result, unmount } = renderHook(useBatchAdvanceWorkflow, { wrapper });
    let completion: Promise<unknown> | undefined;
    act(() => {
      completion = result.current.run(payloads);
    });
    await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(1));
    unmount();
    first.resolve({});
    await completion;
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("does nothing for an empty selection", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useBatchAdvanceWorkflow, { wrapper });
    expect(await result.current.run([])).toEqual({ completed: [], failures: [] });
    expect(requestJson).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("keeps a single-item mutation pending through its one final refresh", async () => {
    const refresh = deferred<void>();
    const { wrapper, invalidate } = setup();
    invalidate.mockReturnValue(refresh.promise);
    const { result } = renderHook(useAdvanceWorkflow, { wrapper });
    let completion: Promise<unknown> | undefined;
    act(() => {
      completion = result.current.mutateAsync(payloads[0]);
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
    expect(result.current.isPending).toBe(true);
    await act(async () => {
      refresh.resolve();
      await completion;
    });
    expect(requestJson).toHaveBeenCalledTimes(1);
  });
});
