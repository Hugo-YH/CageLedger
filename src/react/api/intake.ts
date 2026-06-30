import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { IntakeBatch, IntakeListParams, IntakeWriteResponse, PagedResponse } from "./contracts";
import { requestJson } from "./client";
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

export function useIntakeBatches(params: IntakeListParams) {
  return useQuery({
    queryKey: queryKeys.intake(params as unknown as Record<string, unknown>),
    queryFn: () => requestJson<PagedResponse<IntakeBatch>>(intakeListUrl(params)),
    placeholderData: (previous) => previous,
  });
}

export function useIntakeFilterOptions(params: IntakeListParams, column: string, enabled: boolean) {
  const search = new URLSearchParams({ column, limit: String(params.limit), offset: "0" });
  if (params.columnFilters && Object.keys(params.columnFilters).length) {
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  }
  return useQuery({
    queryKey: ["intake", "filter-options", column, params.columnFilters || {}],
    queryFn: () =>
      requestJson<{ items: Array<{ value: string; label: string; count: number }> }>(
        `/api/intake-batches/filter-options?${search.toString()}`,
      ),
    enabled,
  });
}

export function useSaveIntakeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ item, exists }: { item: IntakeBatch; exists: boolean }) =>
      requestJson<IntakeWriteResponse>(
        exists ? `/api/intake-batches/${encodeURIComponent(item.id)}` : "/api/intake-batches",
        { method: exists ? "PUT" : "POST", body: JSON.stringify({ item }) },
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
