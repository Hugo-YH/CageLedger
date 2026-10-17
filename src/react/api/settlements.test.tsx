import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as billingCompatibility from "./billing";
import { requestDownload, requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import * as quantityCompatibility from "./quantitySheets";
import {
  exportSettlementXlsx,
  exportTechnicalServicePdf,
  generateBillingStatement,
  initiateSettlement,
  previewSettlement,
  useSettlementActions,
} from "./settlements";
import { exportServicesPdf, previewServices, useServiceMutation } from "./technicalServices";
import { invalidateWorkflowQueries } from "./workflows";

vi.mock("./client", () => ({ requestJson: vi.fn(), requestDownload: vi.fn() }));
const target = { pi: "同一负责人", month: "2099-10", sourceType: "pi_merged_technical_service" as const };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("shared settlement actions", () => {
  it.each(["quantity_sheet", "cage_map"] as const)(
    "keeps %s preview and initiation flags and the legacy URL",
    async (sourceType) => {
      await previewSettlement({ ...target, sourceType });
      await initiateSettlement({ ...target, sourceType });
      for (const [index, persist] of [false, true].entries())
        expect(requestJson).toHaveBeenNthCalledWith(index + 1, "/api/billing-statements/generate-by-pi", {
          method: "POST",
          body: JSON.stringify({
            pi: target.pi,
            month: target.month,
            sourceType,
            status: "draft",
            persist,
            initiate: persist,
          }),
        });
    },
  );

  it("previews service versions only when absent and keeps reviewed versions on initiation", async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ sourceVersions: { sheet: "v1" } });
    await initiateSettlement(target);
    expect(requestJson).toHaveBeenNthCalledWith(2, "/api/technical-services/settlements", {
      method: "POST",
      body: JSON.stringify({ pi: target.pi, month: target.month, sourceVersions: { sheet: "v1" } }),
    });
    await initiateSettlement({ ...target, sourceVersions: {} });
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(requestJson).toHaveBeenLastCalledWith("/api/technical-services/settlements", {
      method: "POST",
      body: JSON.stringify({ pi: target.pi, month: target.month, sourceVersions: {} }),
    });
  });

  it("propagates a version conflict without replacing versions or retrying", async () => {
    const conflict = new Error("来源版本已变化");
    vi.mocked(requestJson).mockRejectedValue(conflict);
    await expect(initiateSettlement({ ...target, sourceVersions: { sheet: "reviewed" } })).rejects.toBe(conflict);
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it("retains old exports and service preview/PDF entry points", async () => {
    expect(quantityCompatibility.generateBillingStatement).toBe(generateBillingStatement);
    expect(billingCompatibility.exportSettlementXlsx).toBe(exportSettlementXlsx);
    expect(exportServicesPdf).toBe(exportTechnicalServicePdf);
    await previewServices(target.month, target.pi);
    expect(requestJson).toHaveBeenCalledWith("/api/technical-services/settlements/preview", {
      method: "POST",
      body: JSON.stringify({ pi: target.pi, month: target.month }),
    });
    const items = [target, { ...target, sourceType: "quantity_sheet" }];
    await exportSettlementXlsx(items);
    expect(requestDownload).toHaveBeenCalledWith("/api/billing-settlements/xlsx", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    await exportServicesPdf(target.month, target.pi);
    expect(requestDownload).toHaveBeenCalledWith("/api/technical-services/settlements/pdf", {
      method: "POST",
      body: JSON.stringify({ month: target.month, pi: target.pi }),
    });
  });

  it("invalidates only after initiation; a failed initiation leaves caches intact", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(useSettlementActions, {
      wrapper,
    });
    vi.mocked(requestJson).mockResolvedValue({});
    await act(() => result.current.preview.mutateAsync(target));
    expect(invalidate).not.toHaveBeenCalled();
    await act(() => result.current.initiate.mutateAsync({ ...target, sourceVersions: { sheet: "v1" } }));
    expect(invalidate).toHaveBeenCalledTimes(5);
    invalidate.mockClear();
    vi.mocked(requestJson).mockRejectedValueOnce(new Error("冲突"));
    await act(async () => {
      await expect(result.current.initiate.mutateAsync({ ...target, sourceVersions: { sheet: "v1" } })).rejects.toThrow(
        "冲突",
      );
    });
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });

  it("keeps the legacy service mutation strict when runtime input omits reviewed versions", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(useServiceMutation, { wrapper });
    const conflict = new Error("来源版本已变化");
    vi.mocked(requestJson).mockRejectedValue(conflict);
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          kind: "initiate",
          month: target.month,
          pi: target.pi,
          // Simulate a legacy JavaScript caller bypassing the TypeScript contract.
          sourceVersions: undefined as unknown as Record<string, string>,
        }),
      ).rejects.toBe(conflict);
    });
    expect(requestJson).toHaveBeenCalledExactlyOnceWith("/api/technical-services/settlements", {
      method: "POST",
      body: JSON.stringify({ pi: target.pi, month: target.month }),
    });
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });

  it("refreshes each distinct active workflow-related query once and only marks inactive data stale", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const targets: Array<{ id: string; queryKey: readonly unknown[] }> = [
      { id: "reimbursements", queryKey: queryKeys.reimbursementRoot },
      { id: "settlement candidates", queryKey: queryKeys.settlementCandidatesRoot },
      { id: "workflows", queryKey: queryKeys.workflowsRoot },
      { id: "technical services", queryKey: ["technical-services"] },
      { id: "reimbursement ledger", queryKey: queryKeys.reimbursementLedgerRoot },
    ];
    const requests: string[] = [];
    const unsubscribes = targets.map(({ id, queryKey }) => {
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn: () => {
          requests.push(id);
          return Promise.resolve({ id });
        },
      });
      return observer.subscribe(() => undefined);
    });

    await vi.waitFor(() => expect(requests).toHaveLength(5));
    await vi.waitFor(() =>
      targets.forEach(({ queryKey }) => expect(client.getQueryState(queryKey)?.fetchStatus).toBe("idle")),
    );
    requests.length = 0;
    await invalidateWorkflowQueries(client);
    expect(requests.sort()).toEqual(targets.map(({ id }) => id).sort());

    unsubscribes.forEach((unsubscribe) => unsubscribe());
    requests.length = 0;
    await invalidateWorkflowQueries(client);
    expect(requests).toHaveLength(0);
    targets.forEach(({ queryKey }) => expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true));
    client.clear();
  });
});
