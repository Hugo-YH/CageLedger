import { useQuery } from "@tanstack/react-query";

import type { SettlementCandidateListParams, SettlementCandidateListResponse } from "./contracts";
import { requestDownload, requestJson } from "./client";
import { loadAllPages } from "./pagination";
import { queryKeys } from "./queryKeys";

export function useSettlementCandidates(params: SettlementCandidateListParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.settlementCandidates(params as unknown as Record<string, unknown>),
    queryFn: () => listSettlementCandidates(params),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function listSettlementCandidates(params: SettlementCandidateListParams) {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    sortKey: params.sortKey || "month",
    sortDir: params.sortDir || "desc",
  });
  if (params.columnFilters && Object.keys(params.columnFilters).length) {
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  }
  return requestJson<SettlementCandidateListResponse>(`/api/billing-settlement-candidates?${search.toString()}`);
}

export function listAllSettlementCandidates(params: SettlementCandidateListParams) {
  return loadAllPages((offset, limit) => listSettlementCandidates({ ...params, offset, limit }));
}

export function exportMonthlyBillingSummary(month: string) {
  return requestDownload("/api/billing-monthly-summary/export", {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}
