import { useQuery } from "@tanstack/react-query";

import type { SettlementCandidateListParams, SettlementCandidateListResponse } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useSettlementCandidates(params: SettlementCandidateListParams, enabled = true) {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    sortKey: params.sortKey || "month",
    sortDir: params.sortDir || "desc",
  });
  if (params.columnFilters && Object.keys(params.columnFilters).length) {
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  }
  return useQuery({
    queryKey: queryKeys.settlementCandidates(params as unknown as Record<string, unknown>),
    queryFn: () =>
      requestJson<SettlementCandidateListResponse>(`/api/billing-settlement-candidates?${search.toString()}`),
    placeholderData: (previous) => previous,
    enabled,
  });
}
