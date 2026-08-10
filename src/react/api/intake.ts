import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { IntakeBatch, IntakeListParams, IntakeWriteResponse, PagedResponse } from "./contracts";
import { requestJson } from "./client";
import { useColumnFilterOptions } from "./filterOptions";
import { loadAllPages } from "./pagination";
import { queryKeys } from "./queryKeys";

function intakeListUrl(params: IntakeListParams) {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.sortKey) search.set("sortKey", params.sortKey);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  if (params.columnFilters && Object.keys(params.columnFilters).length) {
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  }
  return `/api/intake-batches?${search.toString()}`;
}

export function listIntakeBatches(params: IntakeListParams) {
  return requestJson<PagedResponse<IntakeBatch>>(intakeListUrl(params));
}

export function useIntakeBatches(params: IntakeListParams) {
  return useQuery({
    queryKey: queryKeys.intake(params as unknown as Record<string, unknown>),
    queryFn: () => listIntakeBatches(params),
    placeholderData: (previous) => previous,
  });
}

export function listAllIntakeBatches(params: IntakeListParams) {
  return loadAllPages((offset, limit) => listIntakeBatches({ ...params, offset, limit }));
}

export function useIntakeFilterOptions(params: IntakeListParams, column: string, enabled: boolean) {
  return useColumnFilterOptions("intake-batches", column, params.columnFilters, enabled);
}

export function useSaveIntakeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ item, exists }: { item: IntakeBatch; exists: boolean }) =>
      requestJson<IntakeWriteResponse>(
        exists ? `/api/intake-batches/${encodeURIComponent(item.id)}` : "/api/intake-batches",
        {
          method: exists ? "PUT" : "POST",
          body: JSON.stringify({ item, expectedUpdatedAt: exists ? item.updatedAt : "" }),
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
  });
}

export function useDeleteIntakeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<IntakeWriteResponse>(`/api/intake-batches/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
  });
}

export function useConfirmIntakeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, actualReceiptDate, cardCount }: { id: string; actualReceiptDate: string; cardCount: number }) =>
      requestJson<IntakeWriteResponse>(`/api/intake-batches/${encodeURIComponent(id)}/confirm-receipt`, {
        method: "POST",
        body: JSON.stringify({ actualReceiptDate, cardCount }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
  });
}

export function useMarkIntakeBatchesPrinted() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      requestJson<{ items: IntakeBatch[] }>("/api/intake-batches/mark-printed", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
  });
}

export function useConfirmIntakeBatchesReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, actualReceiptDate }: { ids: string[]; actualReceiptDate: string }) =>
      requestJson<{ batches: IntakeBatch[] }>("/api/intake-batches/confirm-receipt", {
        method: "POST",
        body: JSON.stringify({ ids, actualReceiptDate }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
  });
}

export async function aiParseIntakeMessage(rawMessage: string, roomNames: string[]) {
  return requestJson<{
    item: Partial<IntakeBatch>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }>("/api/intake/ai-parse", {
    method: "POST",
    body: JSON.stringify({ rawMessage, roomNames }),
  });
}

export function standardizeIntakeStrain(strain: string) {
  return requestJson<{ item: string }>("/api/intake/standardize-strain", {
    method: "POST",
    body: JSON.stringify({ strain }),
  });
}
