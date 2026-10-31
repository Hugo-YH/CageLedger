import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ReceptionExportRequest,
  ReceptionFilterColumn,
  ReceptionListParams,
  ReceptionListResponse,
  ReceptionPreviewResponse,
} from "../../contracts/reception";
import { requestDownload, requestJson } from "./client";
import type { ColumnFilterOption } from "./filterOptions";
import { queryKeys } from "./queryKeys";

export function useReceptions(params: ReceptionListParams) {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    sortKey: params.sortKey,
    sortDir: params.sortDir,
    columnFilters: JSON.stringify(params.columnFilters),
  });
  return useQuery({
    queryKey: queryKeys.receptions(params),
    queryFn: ({ signal }) => requestJson<ReceptionListResponse>(`/api/receptions?${search}`, { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useReceptionFilterOptions(
  column: ReceptionFilterColumn,
  columnFilters: Record<string, string[]>,
  enabled: boolean,
) {
  const search = new URLSearchParams({ column, columnFilters: JSON.stringify(columnFilters) });
  return useQuery({
    queryKey: queryKeys.receptionFilterOptions(column, columnFilters),
    queryFn: ({ signal }) =>
      requestJson<{ items: ColumnFilterOption[] }>(`/api/receptions/filter-options?${search}`, { signal }),
    enabled,
  });
}

export function usePreviewReceptions() {
  return useMutation({
    mutationFn: (request: ReceptionExportRequest) =>
      requestJson<ReceptionPreviewResponse>("/api/receptions/preview", {
        method: "POST",
        body: JSON.stringify(request),
      }),
  });
}

export function useExportReceptions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: ReceptionExportRequest) =>
      requestDownload("/api/receptions/export", { method: "POST", body: JSON.stringify(request) }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }),
  });
}
