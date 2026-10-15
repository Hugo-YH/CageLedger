import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  BillingStatementResponse,
  SettlementCandidateListParams,
  SettlementCandidateListResponse,
} from "../../contracts/billing";
import type {
  GenerateBillingStatementPayload,
  InitiateSettlementPayload,
  ReviewedServiceSettlement,
  SettlementExportTarget,
  SettlementTarget,
} from "../../contracts/settlements";
import type { TechnicalServicePreview } from "../../contracts/technicalServices";
import { requestDownload, requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import { invalidateWorkflowQueries } from "./workflows";

export type { GenerateBillingStatementPayload } from "../../contracts/settlements";

type ServiceTarget = SettlementTarget & { sourceType: "pi_merged_technical_service" };

export function previewSettlement(target: ServiceTarget): Promise<TechnicalServicePreview>;
export function previewSettlement(target: SettlementTarget): Promise<BillingStatementResponse>;
export function previewSettlement({ pi, month, sourceType }: SettlementTarget) {
  if (sourceType === "pi_merged_technical_service")
    return requestJson<TechnicalServicePreview>("/api/technical-services/settlements/preview", {
      method: "POST",
      body: JSON.stringify({ pi, month }),
    });
  return feedingSettlement({ pi, month, sourceType }, false);
}

export function initiateSettlement(target: ServiceTarget & InitiateSettlementPayload): Promise<TechnicalServicePreview>;
export function initiateSettlement(target: InitiateSettlementPayload): Promise<BillingStatementResponse>;
export async function initiateSettlement({ pi, month, sourceType, sourceVersions }: InitiateSettlementPayload) {
  if (sourceType !== "pi_merged_technical_service") return feedingSettlement({ pi, month, sourceType }, true);
  // Obtain versions only when the caller has not already reviewed a preview.
  const versions = sourceVersions ?? (await previewSettlement({ pi, month, sourceType })).sourceVersions;
  return initiateReviewedServiceSettlement({ pi, month, sourceVersions: versions });
}

/** The original service mutation requires supplied versions, even for legacy callers. */
export function initiateReviewedServiceSettlement({ pi, month, sourceVersions }: ReviewedServiceSettlement) {
  return requestJson<TechnicalServicePreview>("/api/technical-services/settlements", {
    method: "POST",
    body: JSON.stringify({ pi, month, sourceVersions }),
  });
}

function feedingSettlement({ pi, month, sourceType }: SettlementTarget, persist: boolean) {
  return requestJson<BillingStatementResponse>("/api/billing-statements/generate-by-pi", {
    method: "POST",
    body: JSON.stringify({ pi, month, sourceType, status: "draft", persist, initiate: persist }),
  });
}

export function usePreviewSettlement() {
  return useMutation({ mutationFn: previewSettlement });
}

export function useInitiateSettlement() {
  const client = useQueryClient();
  return useMutation({ mutationFn: initiateSettlement, onSuccess: () => invalidateWorkflowQueries(client) });
}

export function useSettlementActions() {
  const preview = usePreviewSettlement();
  const initiate = useInitiateSettlement();
  return { preview, initiate, isPending: preview.isPending || initiate.isPending };
}

export function exportSettlementXlsx(items: SettlementExportTarget[]) {
  return requestDownload("/api/billing-settlements/xlsx", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function exportTechnicalServicePdf(month: string, pi: string) {
  return requestDownload("/api/technical-services/settlements/pdf", {
    method: "POST",
    body: JSON.stringify({ month, pi }),
  });
}

/** Keep the original action and hook for integrations still using persist. */
export function generateBillingStatement({ persist = false, ...target }: GenerateBillingStatementPayload) {
  return persist ? initiateSettlement(target) : previewSettlement(target);
}

export function useGenerateBillingStatement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: generateBillingStatement,
    onSuccess: (_data, variables) => {
      if (variables.persist) return invalidateWorkflowQueries(client);
    },
  });
}

function settlementCandidateSearch(params: SettlementCandidateListParams) {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    sortKey: params.sortKey || "month",
    sortDir: params.sortDir || "desc",
  });
  if (params.columnFilters && Object.keys(params.columnFilters).length) {
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  }
  return search;
}

export function fetchSettlementCandidates(params: SettlementCandidateListParams, signal?: AbortSignal) {
  return requestJson<SettlementCandidateListResponse>(
    `/api/settlement-candidates?${settlementCandidateSearch(params).toString()}`,
    { signal },
  );
}

export async function fetchAllSettlementCandidates(params: SettlementCandidateListParams, signal?: AbortSignal) {
  const limit = 100;
  const firstPage = await fetchSettlementCandidates({ ...params, limit, offset: 0 }, signal);
  const items = [...firstPage.items];
  const total = firstPage.page.total;

  for (let offset = limit; offset < total; offset += limit) {
    const nextPage = await fetchSettlementCandidates({ ...params, limit, offset }, signal);
    items.push(...nextPage.items);
  }

  return items;
}

/** Compatibility alias used by the settlement candidate list. */
export function listAllSettlementCandidates(params: SettlementCandidateListParams, signal?: AbortSignal) {
  return fetchAllSettlementCandidates(params, signal);
}

export function useSettlementCandidates(params: SettlementCandidateListParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.settlementCandidates({ ...params }),
    queryFn: ({ signal }) => fetchSettlementCandidates(params, signal),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function exportMonthlyBillingSummary(month: string) {
  return requestDownload("/api/billing-monthly-summary/export", {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}

export function useSettlementFilterOptions(params: SettlementCandidateListParams, column: string, enabled: boolean) {
  const filters = params.columnFilters || {};
  const search = new URLSearchParams({ column, columnFilters: JSON.stringify(filters) });
  return useQuery({
    queryKey: [...queryKeys.settlementCandidatesRoot, "filter-options", column, filters],
    queryFn: ({ signal }) =>
      requestJson<{ items: Array<{ value: string; label: string; count: number }> }>(
        `/api/settlement-candidates/filter-options?${search}`,
        { signal },
      ),
    enabled,
  });
}
