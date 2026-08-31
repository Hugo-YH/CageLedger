import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestJson } from "./client";
import { useGenerateBillingStatement } from "./quantitySheets";
import { queryKeys } from "./queryKeys";
import { useSettlementBatch, type SettlementBatchItem } from "./useSettlementBatch";

vi.mock("./client", () => ({ requestJson: vi.fn() }));
const items: SettlementBatchItem[] = ["a", "b"].map((id) => ({
  candidate: { id, month: "2026-08", pi: id, iacucs: [], manager: "", totalAmount: 10 },
  action: "start",
  source: "quantity_sheet",
}));
function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidate };
}

describe("settlement batch", () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("starts all selected settlements with the unchanged payload and one final refresh", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useSettlementBatch, { wrapper });
    await act(async () => {
      expect((await result.current.run(items)).completed).toEqual(items);
    });
    items.forEach((item, index) => {
      expect(requestJson).toHaveBeenNthCalledWith(index + 1, "/api/billing-statements/generate-by-pi", {
        method: "POST",
        body: JSON.stringify({
          pi: item.candidate.pi,
          month: "2026-08",
          sourceType: "quantity_sheet",
          status: "draft",
          persist: true,
          initiate: true,
        }),
      });
    });
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      queryKeys.reimbursementRoot,
      queryKeys.settlementCandidatesRoot,
      queryKeys.workflowsRoot,
      queryKeys.reimbursementLedgerRoot,
    ]);
  });

  it("deletes generated workflows, reverts sent workflows, and retains missing IDs as failures", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useSettlementBatch, { wrapper });
    const targets: SettlementBatchItem[] = [
      {
        ...items[0],
        action: "withdraw",
        candidate: { ...items[0].candidate, workflowId: "w1", workflowStatus: "statement_generated" },
      },
      {
        ...items[1],
        action: "withdraw",
        candidate: { ...items[1].candidate, workflowId: "w2", workflowStatus: "statement_sent" },
      },
      { ...items[0], action: "withdraw" },
    ];
    await act(async () => {
      expect(await result.current.run(targets)).toEqual({
        completed: targets.slice(0, 2),
        failures: [{ item: targets[2], message: "缺少流程编号" }],
      });
    });
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(requestJson).toHaveBeenNthCalledWith(1, "/api/billing-workflows/w1", { method: "DELETE" });
    expect(requestJson).toHaveBeenNthCalledWith(2, "/api/billing-workflows/advance", {
      method: "POST",
      body: JSON.stringify({ workflowId: "w2", toStatus: "statement_generated", note: "批量撤回，退回已生成" }),
    });
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  it("continues after a server failure without retrying the write", async () => {
    vi.mocked(requestJson).mockRejectedValueOnce(new Error("结算资料不完整"));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useSettlementBatch, { wrapper });
    await act(async () => {
      expect(await result.current.run(items)).toEqual({
        completed: [items[1]],
        failures: [{ item: items[0], message: "结算资料不完整" }],
      });
    });
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  it("does not invalidate on preview but refreshes workflow data when a single settlement starts", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useGenerateBillingStatement, { wrapper });
    const payload = { pi: "a", month: "2026-08", sourceType: "quantity_sheet" as const };
    await act(async () => {
      await result.current.mutateAsync(payload);
    });
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.mutateAsync({ ...payload, persist: true });
    });
    expect(invalidate).toHaveBeenCalledTimes(4);
  });
});
