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
      ["technical-services"],
      queryKeys.reimbursementLedgerRoot,
    ]);
  });

  it("passes the withdrawal reason to deletes and reversions, and retains missing IDs as failures", async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(useSettlementBatch, { wrapper });
    const targets: SettlementBatchItem[] = [
      {
        ...items[0],
        action: "withdraw",
        note: "结算资料需要补充后重新生成",
        candidate: { ...items[0].candidate, workflowId: "w1", workflowStatus: "statement_generated" },
      },
      {
        ...items[1],
        action: "withdraw",
        note: "收件人信息有误，需要重新发起",
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
    expect(requestJson).toHaveBeenNthCalledWith(1, "/api/billing-workflows/w1", {
      method: "DELETE",
      body: JSON.stringify({ note: "结算资料需要补充后重新生成" }),
    });
    expect(requestJson).toHaveBeenNthCalledWith(2, "/api/billing-workflows/advance", {
      method: "POST",
      body: JSON.stringify({ workflowId: "w2", toStatus: "statement_generated", note: "收件人信息有误，需要重新发起" }),
    });
    expect(invalidate).toHaveBeenCalledTimes(5);
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
    expect(invalidate).toHaveBeenCalledTimes(5);
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
    expect(invalidate).toHaveBeenCalledTimes(5);
  });
  it("routes mixed fees separately and submits confirmed service versions", async () => {
    const { wrapper, invalidate } = setup();
    vi.mocked(requestJson)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ sourceVersions: { "service-1": "v1" } })
      .mockResolvedValueOnce({});
    const { result } = renderHook(useSettlementBatch, { wrapper });
    const mixed: SettlementBatchItem[] = [items[0], { ...items[1], source: "pi_merged_technical_service" }];
    await act(async () => {
      expect((await result.current.run(mixed)).completed).toEqual(mixed);
    });
    expect(requestJson).toHaveBeenNthCalledWith(2, "/api/technical-services/settlements/preview", {
      method: "POST",
      body: JSON.stringify({ pi: "b", month: "2026-08" }),
    });
    expect(requestJson).toHaveBeenNthCalledWith(3, "/api/technical-services/settlements", {
      method: "POST",
      body: JSON.stringify({ pi: "b", month: "2026-08", sourceVersions: { "service-1": "v1" } }),
    });
    expect(invalidate).toHaveBeenCalledTimes(5);
  });

  it("does not replace reviewed service versions when confirmation conflicts", async () => {
    const { wrapper, invalidate } = setup();
    vi.mocked(requestJson).mockRejectedValueOnce(new Error("来源版本变化"));
    const { result } = renderHook(useGenerateBillingStatement, { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          pi: "b",
          month: "2026-08",
          sourceType: "pi_merged_technical_service",
          persist: true,
          sourceVersions: { "service-1": "reviewed-v1" },
        }),
      ).rejects.toThrow("来源版本变化");
    });
    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
