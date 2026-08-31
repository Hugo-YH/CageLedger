import { useQuery } from "@tanstack/react-query";

import type { SettlementCandidateListParams, SettlementCandidateListResponse } from "./contracts";
import { requestDownload, requestJson } from "./client";
import { queryKeys } from "./queryKeys";

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
    `/api/billing-settlement-candidates?${settlementCandidateSearch(params).toString()}`,
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

export function exportSettlementXlsx(items: Array<{ month: string; pi: string; sourceType: string }>) {
  return requestDownload("/api/billing-settlements/xlsx", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}
