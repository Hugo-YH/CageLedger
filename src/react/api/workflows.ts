import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PagedResponse, ReimbursementDetailResponse, ReimbursementRecord, ReimbursementStatus } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export interface ReimbursementListParams {
  limit: number;
  offset: number;
  status?: ReimbursementStatus | "all";
  month?: string;
  pi?: string;
  onlyUnpaid?: boolean;
}

function listUrl(params: ReimbursementListParams) {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.month) query.set("month", params.month);
  if (params.pi) query.set("pi", params.pi);
  if (params.onlyUnpaid) query.set("onlyUnpaid", "true");
  return `/api/reimbursement-records?${query.toString()}`;
}

export function useReimbursements(params: ReimbursementListParams) {
  return useQuery({
    queryKey: queryKeys.reimbursements({ ...params }),
    queryFn: () => requestJson<PagedResponse<ReimbursementRecord>>(listUrl(params)),
  });
}

export function useReimbursement(id: string) {
  return useQuery({
    queryKey: queryKeys.reimbursement(id),
    queryFn: () => requestJson<ReimbursementDetailResponse>(`/api/reimbursement-records/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

export function useUpdateReimbursement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
      expectedUpdatedAt,
    }: {
      id: string;
      patch: Partial<ReimbursementRecord>;
      expectedUpdatedAt: string;
    }) =>
      requestJson<ReimbursementDetailResponse>(`/api/reimbursement-records/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...patch, expectedUpdatedAt }),
      }),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.reimbursement(data.item.id), data);
      void client.invalidateQueries({ queryKey: queryKeys.reimbursementRoot });
    },
  });
}

export function useDeleteReimbursement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ ok: true }>(`/api/reimbursement-records/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.reimbursementRoot }),
  });
}

export function useAdvanceWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: { workflowId: string; toStatus: string; note?: string }) =>
      requestJson<Record<string, unknown>>("/api/billing-workflows/advance", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.reimbursementRoot }),
  });
}
