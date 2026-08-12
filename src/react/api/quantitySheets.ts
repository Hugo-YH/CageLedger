import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  BillingStatementResponse,
  CageRoom,
  PagedResponse,
  QuantitySheet,
  QuantitySheetListParams,
  QuantitySheetWriteResponse,
} from "./contracts";
import { requestJson } from "./client";
import { useColumnFilterOptions } from "./filterOptions";
import { loadAllPages } from "./pagination";
import { queryKeys } from "./queryKeys";

function listUrl(params: QuantitySheetListParams) {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.sortKey) search.set("sortKey", params.sortKey);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  if (params.columnFilters && Object.keys(params.columnFilters).length)
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  return `/api/quantity-sheets?${search.toString()}`;
}

export function listQuantitySheets(params: QuantitySheetListParams) {
  return requestJson<PagedResponse<QuantitySheet>>(listUrl(params));
}

export function useQuantitySheets(params: QuantitySheetListParams) {
  return useQuery({
    queryKey: queryKeys.quantitySheets(params as unknown as Record<string, unknown>),
    queryFn: () => listQuantitySheets(params),
    placeholderData: (previous) => previous,
  });
}

export function useQuantitySheetPiHistory(iacuc: string, beforeMonth: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.quantitySheetPiHistory(iacuc.trim().toUpperCase(), beforeMonth),
    queryFn: () =>
      requestJson<{ item: { month: string; pi: string } | null }>(
        `/api/quantity-sheets/pi-history?iacuc=${encodeURIComponent(iacuc.trim().toUpperCase())}&beforeMonth=${encodeURIComponent(beforeMonth)}`,
      ),
    enabled: enabled && Boolean(iacuc.trim()) && Boolean(beforeMonth),
    staleTime: 60 * 1000,
  });
}

export function listAllQuantitySheets(params: QuantitySheetListParams) {
  return loadAllPages((offset, limit) => listQuantitySheets({ ...params, offset, limit }));
}

export function useQuantitySheetRooms() {
  return useQuery({
    queryKey: queryKeys.quantitySheetRooms,
    queryFn: () => requestJson<{ items: CageRoom[] }>("/api/quantity-sheet-rooms"),
  });
}

export function useQuantityFilterOptions(params: QuantitySheetListParams, column: string, enabled: boolean) {
  return useColumnFilterOptions("quantity-sheets", column, params.columnFilters, enabled);
}

export function useQuantitySheetDetail(id: string) {
  return useQuery({
    queryKey: ["quantity-sheets", "detail", id],
    queryFn: () => requestJson<{ item: QuantitySheet }>(`/api/quantity-sheets/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

export function fetchQuantitySheetsForPrint(ids: string[]) {
  return requestJson<{ items: QuantitySheet[] }>("/api/quantity-sheets/print-data", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function useSaveQuantitySheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sheet, exists }: { sheet: QuantitySheet; exists: boolean }) =>
      requestJson<QuantitySheetWriteResponse>(
        exists ? `/api/quantity-sheets/${encodeURIComponent(sheet.id)}` : "/api/quantity-sheets",
        {
          method: exists ? "PUT" : "POST",
          body: JSON.stringify({ sheet, expectedUpdatedAt: exists ? sheet.updatedAt : "" }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quantitySheetsRoot });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settlementCandidatesRoot });
    },
  });
}

export function useDeleteQuantitySheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ auditLogs?: Record<string, unknown>[] }>(`/api/quantity-sheets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.quantitySheetsRoot });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settlementCandidatesRoot });
    },
  });
}

export function useGenerateBillingStatement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      pi,
      month,
      sourceType,
      persist = false,
    }: {
      pi: string;
      month: string;
      sourceType: "quantity_sheet" | "cage_map";
      persist?: boolean;
    }) =>
      requestJson<BillingStatementResponse>("/api/billing-statements/generate-by-pi", {
        method: "POST",
        body: JSON.stringify({ pi, month, sourceType, status: "draft", persist, initiate: persist }),
      }),
    onSuccess: (_data, variables) => {
      if (!variables.persist) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.settlementCandidatesRoot });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reimbursementLedgerRoot });
    },
  });
}
