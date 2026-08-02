import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  PagedResponse,
  ReimbursementAllocation,
  ReimbursementClaim,
  ReimbursementFundingLine,
  SettlementObligation,
} from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export interface LedgerListParams {
  limit: number;
  offset: number;
  month?: string;
  sourcePi?: string;
  fundingOwner?: string;
  iacuc?: string;
  status?: string;
  keyword?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  columnFilters?: Record<string, string[]>;
}

function queryUrl(path: string, params: LedgerListParams) {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  for (const [key, value] of Object.entries(params)) {
    if (key === "limit" || key === "offset" || !value) continue;
    if (key === "columnFilters") {
      query.set(key, JSON.stringify(value));
      continue;
    }
    query.set(key, String(value));
  }
  return `${path}?${query.toString()}`;
}

export function useLedgerFilterOptions(path: string, params: LedgerListParams, column: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reimbursement-ledger", "filter-options", path, column, params.columnFilters || {}],
    queryFn: async () => {
      const otherFilters = { ...(params.columnFilters || {}) };
      delete otherFilters[column];
      const listParams = { ...params, limit: 10000, offset: 0, columnFilters: otherFilters };
      delete listParams.sortKey;
      delete listParams.sortDir;
      const data = await requestJson<PagedResponse<Record<string, unknown>>>(queryUrl(path, listParams));
      const counts = new Map<string, number>();
      for (const item of data.items) {
        const value = item[column] == null ? "" : String(item[column]);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const items = [...counts.entries()]
        .map(([value, count]) => ({ value, label: value || "（空）", count }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
      return { items };
    },
    enabled,
  });
}

function invalidateLedger(client: ReturnType<typeof useQueryClient>) {
  return client.invalidateQueries({ queryKey: queryKeys.reimbursementLedgerRoot });
}

export function useSettlementObligations(params: LedgerListParams) {
  return useQuery({
    queryKey: queryKeys.reimbursementObligations({ ...params }),
    queryFn: () =>
      requestJson<PagedResponse<SettlementObligation>>(queryUrl("/api/reimbursement-ledger/obligations", params)),
  });
}

export function useReimbursementClaims(params: LedgerListParams) {
  return useQuery({
    queryKey: queryKeys.reimbursementClaims({ ...params }),
    queryFn: () => requestJson<PagedResponse<ReimbursementClaim>>(queryUrl("/api/reimbursement-ledger/claims", params)),
  });
}

export function useReimbursementClaim(id: string) {
  return useQuery({
    queryKey: queryKeys.reimbursementClaim(id),
    queryFn: () =>
      requestJson<{ item: ReimbursementClaim }>(`/api/reimbursement-ledger/claims/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

export function useLegacyReimbursements(params: LedgerListParams) {
  return useQuery({
    queryKey: queryKeys.reimbursementLegacy({ ...params }),
    queryFn: () =>
      requestJson<PagedResponse<Record<string, unknown>>>(queryUrl("/api/reimbursement-ledger/legacy-records", params)),
  });
}

export function useSaveReimbursementClaim() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      item,
    }: {
      id?: string;
      item: Partial<ReimbursementClaim> & { fundingLines: ReimbursementFundingLine[] };
    }) =>
      requestJson<{ item: ReimbursementClaim }>(
        id ? `/api/reimbursement-ledger/claims/${encodeURIComponent(id)}` : "/api/reimbursement-ledger/claims",
        {
          method: id ? "PUT" : "POST",
          body: JSON.stringify(item),
        },
      ),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.reimbursementClaim(data.item.id), data);
      void invalidateLedger(client);
    },
  });
}

export function useCreateReimbursementAllocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      claimId,
      fundingLineId,
      obligationId,
      amount,
    }: {
      claimId: string;
      fundingLineId: string;
      obligationId: string;
      amount: number;
    }) =>
      requestJson<{ item: ReimbursementAllocation }>(
        `/api/reimbursement-ledger/claims/${encodeURIComponent(claimId)}/allocations`,
        {
          method: "POST",
          body: JSON.stringify({ fundingLineId, obligationId, amount }),
        },
      ),
    onSuccess: () => void invalidateLedger(client),
  });
}

export function useConfirmReimbursementAllocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ item: ReimbursementAllocation }>(
        `/api/reimbursement-ledger/allocations/${encodeURIComponent(id)}/confirm`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: () => void invalidateLedger(client),
  });
}

export function useReverseReimbursementAllocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      requestJson<{ item: ReimbursementAllocation }>(
        `/api/reimbursement-ledger/allocations/${encodeURIComponent(id)}/reverse`,
        { method: "POST", body: JSON.stringify({ reason }) },
      ),
    onSuccess: () => void invalidateLedger(client),
  });
}

export function useMigrateLegacyReimbursement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ item: ReimbursementClaim }>(
        `/api/reimbursement-ledger/legacy-records/${encodeURIComponent(id)}/migrate`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: () => void invalidateLedger(client),
  });
}
