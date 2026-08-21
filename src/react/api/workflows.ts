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

export interface BillingWorkflowAttachment {
  id: string;
  workflowId: string;
  kind: "settlement" | "reimbursement";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BillingWorkflowEvent {
  id: string;
  workflowId: string;
  versionId: string;
  eventType: string;
  fromStatus: string;
  toStatus: string;
  at: string;
  actor: { id: string; username: string; displayName: string };
  note: string;
  signedStatementNote?: string;
  reimbursementFormNote?: string;
}

export interface BillingWorkflow {
  id: string;
  businessKey: string;
  iacuc: string;
  iacucs: string[];
  month: string;
  sourceType: string;
  workflowStatus: string;
  currentVersionNo?: number;
  pi: string;
  project: string;
  owner: string;
  funding: string;
  manager: string;
  totalAmount: number;
  reimbursementRequired?: boolean;
  totalCageDays: number;
  generatedAt: string;
  sentAt: string;
  sentBy?: { id: string; username: string; displayName: string };
  sheetUpdatedAt?: string;
  signedReturnedAt: string;
  registeredAt: string;
  archivedAt: string;
  lockedFromStatus?: string;
  signedStatementReturned?: boolean;
  signedStatementNote?: string;
  reimbursementFormReturned?: boolean;
  reimbursementFormNote?: string;
  reimbursementFormNos?: string[];
  reimbursementForms?: Array<{ formNo: string; amount: number; fundingBookNo?: string }>;
  receivedAmount?: number;
  attachments?: BillingWorkflowAttachment[];
  registeredBy?: { id: string; username: string; displayName: string };
  reimbursementRecordedAt?: string;
  reimbursementRecordedBy?: { id: string; username: string; displayName: string };
  latestEventAt: string;
}

export interface WorkflowFundingBookOption {
  value: string;
  label: string;
  source: "fundCode" | "funding";
  iacucs: string[];
}

export interface WorkflowFundingBookOptionsResponse {
  items: WorkflowFundingBookOption[];
  iacucs: string[];
  piFundingBookNos: string[];
  piFundingBookOptions: WorkflowFundingBookOption[];
}

export interface WorkflowListParams {
  limit: number;
  offset: number;
  status?: string;
  month?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  columnFilters?: Record<string, string[]>;
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reimbursementRoot });
      void client.invalidateQueries({ queryKey: ["billing-workflows"] });
      void client.invalidateQueries({ queryKey: queryKeys.settlementCandidatesRoot });
    },
  });
}

export function useAdvanceWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      workflowId: string;
      toStatus: string;
      note?: string;
      registration?: {
        reimbursementForms?: Array<{ formNo: string; amount: number; fundingBookNo?: string }>;
        signedStatementReturned?: boolean;
        signedStatementNote?: string;
        reimbursementFormReturned?: boolean;
        reimbursementFormNote?: string;
      };
    }) =>
      requestJson<Record<string, unknown>>("/api/billing-workflows/advance", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reimbursementRoot });
      void client.invalidateQueries({ queryKey: queryKeys.settlementCandidatesRoot });
      void client.invalidateQueries({ queryKey: ["billing-workflows"] });
    },
  });
}

export function useBillingWorkflows(params: WorkflowListParams) {
  return useQuery({
    queryKey: queryKeys.workflows({ ...params }),
    queryFn: () =>
      requestJson<PagedResponse<BillingWorkflow>>(`/api/billing-workflows?${billingWorkflowSearch(params).toString()}`),
  });
}

export function useWorkflowFundingBookOptions(workflowId: string) {
  return useQuery({
    queryKey: queryKeys.workflowFundingBookOptions(workflowId),
    queryFn: () =>
      requestJson<WorkflowFundingBookOptionsResponse>(
        `/api/billing-workflows/${encodeURIComponent(workflowId)}/funding-options`,
      ),
    enabled: Boolean(workflowId),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

function billingWorkflowSearch(params: WorkflowListParams) {
  const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.status) query.set("status", params.status);
  if (params.month) query.set("month", params.month);
  if (params.sortKey) query.set("sortKey", params.sortKey);
  if (params.sortDir) query.set("sortDir", params.sortDir);
  if (params.columnFilters && Object.keys(params.columnFilters).length) {
    query.set("columnFilters", JSON.stringify(params.columnFilters));
  }
  return query;
}

export async function fetchAllBillingWorkflows(params: WorkflowListParams) {
  const limit = 100;
  const firstPage = await requestJson<PagedResponse<BillingWorkflow>>(
    `/api/billing-workflows?${billingWorkflowSearch({ ...params, limit, offset: 0 }).toString()}`,
  );
  const items = [...firstPage.items];
  const total = firstPage.page.total;

  for (let offset = limit; offset < total; offset += limit) {
    const nextPage = await requestJson<PagedResponse<BillingWorkflow>>(
      `/api/billing-workflows?${billingWorkflowSearch({ ...params, limit, offset }).toString()}`,
    );
    items.push(...nextPage.items);
  }

  return items;
}

export async function fetchWorkflowDetail(workflowId: string) {
  return requestJson<{
    workflow: BillingWorkflow;
    versions: unknown[];
    events: BillingWorkflowEvent[];
  }>(`/api/billing-workflows/${encodeURIComponent(workflowId)}`);
}

export async function uploadWorkflowAttachment(workflowId: string, kind: "settlement" | "reimbursement", file: File) {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(
    `/api/billing-workflows/${encodeURIComponent(workflowId)}/attachments?kind=${encodeURIComponent(kind)}`,
    {
      method: "POST",
      body: form,
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => ({}))) as { item?: BillingWorkflowAttachment; error?: string };
  if (!response.ok) throw new Error(payload.error || `上传失败 (${response.status})`);
  return payload.item;
}

export function useDeleteBillingWorkflow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) =>
      requestJson<{ ok: true }>(`/api/billing-workflows/${encodeURIComponent(workflowId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.reimbursementRoot });
      void client.invalidateQueries({ queryKey: ["billing-workflows"] });
      void client.invalidateQueries({ queryKey: queryKeys.settlementCandidatesRoot });
    },
  });
}

export async function recordWorkflowReimbursement(
  workflowId: string,
  reimbursementForms: Array<{ formNo: string; amount: number; fundingBookNo?: string }>,
) {
  const payload = await requestJson<Record<string, unknown>>(
    `/api/billing-workflows/${encodeURIComponent(workflowId)}/reimbursement-forms`,
    {
      method: "POST",
      body: JSON.stringify({ reimbursementForms }),
    },
  );
  return payload;
}
