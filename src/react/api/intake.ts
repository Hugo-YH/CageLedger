import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  IntakeBatch,
  IntakeBatchListItem,
  IntakeAiParseResponse,
  IntakeRecognitionImageInput,
  IntakeDuplicateDetails,
  IntakeListParams,
  IntakeSaveRequest,
  IntakeSummaryExportParams,
  IntakeWriteResponse,
  PagedResponse,
} from "./contracts";
import { ApiError, requestDownload, requestJson } from "./client";
import { useColumnFilterOptions } from "./filterOptions";
import { loadAllPages } from "./pagination";
import { queryKeys } from "./queryKeys";
import { individualPeople } from "./personNames";

function intakeListUrl(params: IntakeListParams, summary = false) {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.sortKey) search.set("sortKey", params.sortKey);
  if (summary) search.set("view", "summary");
  if (params.personFilterMode) search.set("personFilterMode", params.personFilterMode);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  if (params.columnFilters && Object.keys(params.columnFilters).length) {
    search.set("columnFilters", JSON.stringify(params.columnFilters));
  }
  return `/api/intake-batches?${search.toString()}`;
}

export function listIntakeBatches(params: IntakeListParams, signal?: AbortSignal) {
  return requestJson<PagedResponse<IntakeBatch>>(intakeListUrl(params), { signal });
}

export function useExportIntakeSummary() {
  return useMutation({
    mutationFn: (params: IntakeSummaryExportParams) =>
      requestDownload(`/api/intake-batches/summary.docx?${new URLSearchParams({ ...params }).toString()}`),
  });
}

export function useIntakeBatches(inputParams: IntakeListParams, enabled = true) {
  const params = individualPeople(inputParams);
  return useQuery({
    queryKey: queryKeys.intake({ ...params }),
    queryFn: ({ signal }) => listIntakeBatchSummaries(params, signal),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function listIntakeBatchSummaries(params: IntakeListParams, signal?: AbortSignal) {
  return requestJson<PagedResponse<IntakeBatchListItem>>(intakeListUrl(params, true), { signal });
}

export function listAllIntakeBatchSummaries(params: IntakeListParams, signal?: AbortSignal) {
  params = individualPeople(params);
  return loadAllPages((offset, limit) => listIntakeBatchSummaries({ ...params, offset, limit }, signal));
}

export function useIntakeBatchDetail(id: string) {
  return useQuery({
    queryKey: [...queryKeys.intakeRoot, "detail", id],
    queryFn: ({ signal }) =>
      requestJson<{ item: IntakeBatch }>(`/api/intake-batches/${encodeURIComponent(id)}`, { signal }),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export async function fetchIntakeBatchesForPrint(items: IntakeBatchListItem[]) {
  const result: IntakeBatch[] = [];
  for (let offset = 0; offset < items.length; offset += 200) {
    const part = items.slice(offset, offset + 200);
    const response = await requestJson<{ items: IntakeBatch[] }>("/api/intake-batches/print-data", {
      method: "POST",
      body: JSON.stringify({
        ids: part.map((item) => item.id),
        expectedVersions: Object.fromEntries(part.map((item) => [item.id, String(item.updatedAt || "")])),
      }),
    });
    result.push(...response.items);
  }
  return result;
}

export function listAllIntakeBatches(params: IntakeListParams, signal?: AbortSignal) {
  return loadAllPages((offset, limit) => listIntakeBatches({ ...params, offset, limit }, signal));
}

export function useIntakeFilterOptions(params: IntakeListParams, column: string, enabled: boolean) {
  return useColumnFilterOptions("intake-batches", column, params.columnFilters, enabled);
}

export function saveIntakeBatch({
  item,
  exists,
  checkDuplicates,
  duplicateConfirmation,
  recognitionImages,
}: IntakeSaveRequest) {
  return requestJson<IntakeWriteResponse>(
    exists ? `/api/intake-batches/${encodeURIComponent(item.id)}` : "/api/intake-batches",
    {
      method: exists ? "PUT" : "POST",
      body: JSON.stringify({
        item,
        ...(recognitionImages?.length ? { recognitionImages } : {}),
        expectedUpdatedAt: exists ? item.updatedAt : "",
        ...(checkDuplicates ? { checkDuplicates: true } : {}),
        ...(duplicateConfirmation ? { duplicateConfirmation } : {}),
      }),
    },
  );
}

function isIntakeDuplicateDetails(value: unknown): value is IntakeDuplicateDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const details = value as Record<string, unknown>;
  return (
    Array.isArray(details.items) &&
    typeof details.total === "number" &&
    typeof details.confirmationToken === "string" &&
    Boolean(details.confirmationToken)
  );
}

export function intakeDuplicateDetails(error: unknown): IntakeDuplicateDetails | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== "INTAKE_DUPLICATE_CONFIRMATION_REQUIRED") {
    return null;
  }
  return isIntakeDuplicateDetails(error.details) ? error.details : null;
}

export function useSaveIntakeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveIntakeBatch,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
        queryClient.invalidateQueries({ queryKey: ["filter-options", "intake-batches"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quarantine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverviewRoot }),
        queryClient.invalidateQueries({ queryKey: ["audit-events"] }),
      ]),
  });
}

export function useDeleteIntakeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<IntakeWriteResponse>(`/api/intake-batches/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
        queryClient.invalidateQueries({ queryKey: ["filter-options", "intake-batches"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quarantine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverviewRoot }),
      ]),
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
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
        queryClient.invalidateQueries({ queryKey: ["filter-options", "intake-batches"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quarantine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverviewRoot }),
      ]),
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
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
        queryClient.invalidateQueries({ queryKey: ["filter-options", "intake-batches"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quarantine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverviewRoot }),
      ]),
  });
}

export function useConfirmIntakeBatchesReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids }: { ids: string[] }) =>
      requestJson<{ batches: IntakeBatch[] }>("/api/intake-batches/confirm-receipt", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
        queryClient.invalidateQueries({ queryKey: ["filter-options", "intake-batches"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.quarantine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverviewRoot }),
      ]),
  });
}

export async function aiParseIntakeMessage(
  rawMessage: string,
  roomNames: string[],
  images?: IntakeRecognitionImageInput[],
  signal?: AbortSignal,
) {
  return requestJson<IntakeAiParseResponse>("/api/intake/ai-parse", {
    method: "POST",
    signal,
    body: JSON.stringify({ rawMessage, roomNames, ...(images?.length ? { images } : {}) }),
  });
}

export function standardizeIntakeStrain(strain: string) {
  return requestJson<{ item: string }>("/api/intake/standardize-strain", {
    method: "POST",
    body: JSON.stringify({ strain }),
  });
}
