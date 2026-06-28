import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BillingStatementResponse, CageRoom, PagedResponse, QuantitySheet, QuantitySheetListParams, QuantitySheetWriteResponse } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

function listUrl(params: QuantitySheetListParams) {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.sortKey) search.set("sortKey", params.sortKey);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  if (params.columnFilters && Object.keys(params.columnFilters).length) search.set("columnFilters", JSON.stringify(params.columnFilters));
  return `/api/quantity-sheets?${search.toString()}`;
}

export function useQuantitySheets(params: QuantitySheetListParams) {
  return useQuery({ queryKey: queryKeys.quantitySheets(params as unknown as Record<string, unknown>), queryFn: () => requestJson<PagedResponse<QuantitySheet>>(listUrl(params)), placeholderData: (previous) => previous });
}

export function useQuantitySheetRooms() {
  return useQuery({ queryKey: queryKeys.quantitySheetRooms, queryFn: () => requestJson<{ items: CageRoom[] }>("/api/quantity-sheet-rooms") });
}

export function useQuantityFilterOptions(params: QuantitySheetListParams, column: string, enabled: boolean) {
  const search = new URLSearchParams({ column, limit: String(params.limit), offset: "0" });
  if (params.columnFilters && Object.keys(params.columnFilters).length) search.set("columnFilters", JSON.stringify(params.columnFilters));
  return useQuery({ queryKey: ["quantity-sheets", "filter-options", column, params.columnFilters || {}], queryFn: () => requestJson<{ items: Array<{ value: string; label: string; count: number }> }>(`/api/quantity-sheets/filter-options?${search.toString()}`), enabled });
}

export function useQuantitySheetDetail(id: string) {
  return useQuery({ queryKey: ["quantity-sheets", "detail", id], queryFn: () => requestJson<{ item: QuantitySheet }>(`/api/quantity-sheets/${encodeURIComponent(id)}`), enabled: Boolean(id) });
}

export function useSaveQuantitySheet() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ sheet, exists }: { sheet: QuantitySheet; exists: boolean }) => requestJson<QuantitySheetWriteResponse>(exists ? `/api/quantity-sheets/${encodeURIComponent(sheet.id)}` : "/api/quantity-sheets", { method: exists ? "PUT" : "POST", body: JSON.stringify({ sheet }) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quantitySheetsRoot }) });
}

export function useDeleteQuantitySheet() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => requestJson<{ auditLogs?: Record<string, unknown>[] }>(`/api/quantity-sheets/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quantitySheetsRoot }) });
}

export function useGenerateBillingStatement() {
  return useMutation({ mutationFn: ({ pi, month, sourceType, persist = false }: { pi: string; month: string; sourceType: "quantity_sheet" | "cage_map"; persist?: boolean }) => requestJson<BillingStatementResponse>("/api/billing-statements/generate-by-pi", { method: "POST", body: JSON.stringify({ pi, month, sourceType, status: "draft", persist }) }) });
}
