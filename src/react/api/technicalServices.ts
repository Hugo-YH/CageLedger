import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PagedResponse } from "../../contracts/common";
import type {
  TechnicalServiceCandidate,
  TechnicalServiceCatalogItem,
  TechnicalServiceListParams,
  TechnicalServiceListItem,
  TechnicalServiceSheet,
} from "../../contracts/technicalServices";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import { initiateReviewedServiceSettlement, previewSettlement } from "./settlements";

export { exportTechnicalServicePdf as exportServicesPdf } from "./settlements";

const root = ["technical-services"] as const;
const base = "/api/technical-services";
export type ServiceListParams = TechnicalServiceListParams;

function listSearch(params: Partial<ServiceListParams> & { view?: "summary" }) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]),
  );
}

export function useServiceCatalog() {
  return useQuery({
    queryKey: [...root, "catalog"],
    queryFn: ({ signal }) => requestJson<{ items: TechnicalServiceCatalogItem[] }>(`${base}/catalog`, { signal }),
  });
}

export function useServiceList(params: ServiceListParams) {
  const resource = "sheets";
  return useQuery<PagedResponse<TechnicalServiceListItem>>({
    placeholderData: (previous) => previous,
    queryKey: queryKeys.technicalServiceSheets(params),
    queryFn: ({ signal }) =>
      requestJson<PagedResponse<TechnicalServiceListItem>>(
        `${base}/${resource}?${listSearch({ ...params, view: "summary" })}`,
        { signal },
      ),
  });
}

export function useServiceDetail(id: string) {
  return useQuery({
    queryKey: [...root, "sheet-detail", id],
    queryFn: ({ signal }) =>
      requestJson<{ item: TechnicalServiceSheet }>(`${base}/sheets/${encodeURIComponent(id)}`, { signal }),
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useServiceCandidates(params: ServiceListParams) {
  return useQuery<PagedResponse<TechnicalServiceCandidate>>({
    placeholderData: (previous) => previous,
    queryKey: [...root, "settlement-candidates", params],
    queryFn: ({ signal }) =>
      requestJson<PagedResponse<TechnicalServiceCandidate>>(`${base}/settlement-candidates?${listSearch(params)}`, {
        signal,
      }),
  });
}

export function useServiceFilterOptions(
  list: "sheets" | "settlement-candidates",
  params: ServiceListParams,
  column: string,
  enabled: boolean,
) {
  const filters = { month: params.month, keyword: params.keyword, columnFilters: params.columnFilters };
  return useQuery({
    queryKey: [...root, `${list}-filter-options`, filters, column],
    queryFn: ({ signal }) =>
      requestJson<{ items: Array<{ value: string; label: string; count: number }> }>(
        `${base}/${list}/filter-options?${listSearch(filters)}&column=${encodeURIComponent(column)}`,
        { signal },
      ),
    enabled,
  });
}

export function useServiceMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      action:
        | { kind: "save"; sheet: TechnicalServiceSheet; editing: boolean }
        | { kind: "delete"; sheet: TechnicalServiceListItem }
        | { kind: "initiate"; month: string; pi: string; sourceVersions: Record<string, string> },
    ) => {
      if (action.kind === "initiate") return initiateReviewedServiceSettlement(action);
      const { sheet } = action;
      return requestJson<{ item?: TechnicalServiceSheet }>(
        `${base}/sheets${action.kind === "delete" || action.editing ? `/${encodeURIComponent(sheet.id)}` : ""}`,
        {
          method: action.kind === "delete" ? "DELETE" : action.editing ? "PUT" : "POST",
          body: JSON.stringify({ sheet, expectedUpdatedAt: sheet.updatedAt }),
        },
      );
    },
    onSuccess: async () => {
      await Promise.all(
        [
          root,
          ["billing-settlement-candidates"],
          ["billing-workflows"],
          ["reimbursement-ledger"],
          ["reimbursement-records"],
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      );
    },
  });
}

export function previewServices(month: string, pi: string) {
  return previewSettlement({ month, pi, sourceType: "pi_merged_technical_service" });
}
