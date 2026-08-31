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
import { invalidateWorkflowQueries } from "./workflows";

function listUrl(params: QuantitySheetListParams) {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.sortKey) search.set("sortKey", params.sortKey);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  if (params.columnFilters && Object.keys(params.columnFilters).length)
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  return `/api/quantity-sheets?${search.toString()}`;
}

export function listQuantitySheets(params: QuantitySheetListParams, signal?: AbortSignal) {
  return requestJson<PagedResponse<QuantitySheet>>(listUrl(params), { signal });
}

export function useQuantitySheets(params: QuantitySheetListParams) {
  return useQuery({
    queryKey: queryKeys.quantitySheets({ ...params }),
    queryFn: ({ signal }) => listQuantitySheets(params, signal),
    placeholderData: (previous) => previous,
  });
}

export function useQuantitySheetPiHistory(iacuc: string, beforeMonth: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.quantitySheetPiHistory(iacuc.trim().toUpperCase(), beforeMonth),
    queryFn: ({ signal }) =>
      requestJson<{ item: { month: string; pi: string } | null }>(
        `/api/quantity-sheets/pi-history?iacuc=${encodeURIComponent(iacuc.trim().toUpperCase())}&beforeMonth=${encodeURIComponent(beforeMonth)}`,
        { signal },
      ),
    enabled: enabled && Boolean(iacuc.trim()) && Boolean(beforeMonth),
    staleTime: 60 * 1000,
  });
}

export function listAllQuantitySheets(params: QuantitySheetListParams, signal?: AbortSignal) {
  return loadAllPages((offset, limit) => listQuantitySheets({ ...params, offset, limit }, signal));
}

export function useQuantitySheetRooms() {
  return useQuery({
    queryKey: queryKeys.quantitySheetRooms,
    queryFn: ({ signal }) => requestJson<{ items: CageRoom[] }>("/api/quantity-sheet-rooms", { signal }),
  });
}

export function useQuantityFilterOptions(params: QuantitySheetListParams, column: string, enabled: boolean) {
  return useColumnFilterOptions("quantity-sheets", column, params.columnFilters, enabled);
}

export function useQuantitySheetDetail(id: string) {
  return useQuery({
    queryKey: ["quantity-sheets", "detail", id],
    queryFn: ({ signal }) =>
      requestJson<{ item: QuantitySheet }>(`/api/quantity-sheets/${encodeURIComponent(id)}`, { signal }),
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

export interface GenerateBillingStatementPayload {
  pi: string;
  month: string;
  sourceType: "quantity_sheet" | "cage_map";
  persist?: boolean;
}

export function generateBillingStatement({ pi, month, sourceType, persist = false }: GenerateBillingStatementPayload) {
  return requestJson<BillingStatementResponse>("/api/billing-statements/generate-by-pi", {
    method: "POST",
    body: JSON.stringify({ pi, month, sourceType, status: "draft", persist, initiate: persist }),
  });
}

export function useGenerateBillingStatement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateBillingStatement,
    onSuccess: (_data, variables) => {
      if (!variables.persist) return;
      return Promise.all([
        invalidateWorkflowQueries(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.reimbursementLedgerRoot }),
      ]);
    },
  });
}
