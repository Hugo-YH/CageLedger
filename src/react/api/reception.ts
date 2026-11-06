import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ReceptionExportRequest,
  ReceptionFilterColumn,
  ReceptionListParams,
  ReceptionListResponse,
  ReceptionPreviewSummaryResponse,
  ReceptionCertificateAttachment,
  ReceptionRecognitionRequest,
  ReceptionRecognitionRun,
  ReceptionRegistration,
  ReceptionRegistrationResponse,
  ReceptionRegistrationSaveRequest,
} from "../../contracts/reception";
import { requestDownload, requestJson, requestMultipart } from "./client";
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
    mutationFn: ({ signal, ...request }: ReceptionExportRequest & { signal?: AbortSignal }) =>
      requestJson<ReceptionPreviewSummaryResponse>("/api/receptions/preview", {
        method: "POST",
        body: JSON.stringify({ ...request, view: "summary" }),
        signal,
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

function registrationUrl(batchId: string) {
  return `/api/receptions/${encodeURIComponent(batchId)}`;
}

export function useReceptionRegistration(batchId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.receptionRegistration(batchId),
    queryFn: ({ signal }) =>
      requestJson<ReceptionRegistrationResponse>(`${registrationUrl(batchId)}/registration`, { signal }),
    enabled: Boolean(batchId) && enabled,
  });
}

function useInvalidateRegistration(batchId: string) {
  const client = useQueryClient();
  return ({ refreshList = false, deferRegistrationRefresh = false } = {}) =>
    Promise.all([
      client.invalidateQueries({
        queryKey: queryKeys.receptionRegistration(batchId),
        exact: true,
        refetchType: deferRegistrationRefresh ? "none" : "active",
      }),
      ...(refreshList ? [client.invalidateQueries({ queryKey: queryKeys.receptionListRoot })] : []),
      client.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }),
    ]);
}

export function useUploadReceptionCertificate(batchId: string) {
  const client = useQueryClient();
  const invalidate = useInvalidateRegistration(batchId);
  return useMutation({
    retry: 0,
    mutationFn: ({
      file,
      expectedBatchUpdatedAt,
    }: {
      file: File;
      expectedBatchUpdatedAt: string;
      deferRegistrationRefresh?: boolean;
    }) => {
      const form = new FormData();
      form.append("file", file);
      const search = new URLSearchParams({ expectedBatchUpdatedAt });
      return requestMultipart<{ attachment: ReceptionCertificateAttachment; reused: boolean }>(
        `${registrationUrl(batchId)}/certificates?${search}`,
        form,
      );
    },
    onSuccess: ({ attachment }, variables) => {
      client.setQueryData<ReceptionRegistrationResponse>(queryKeys.receptionRegistration(batchId), (current) =>
        current
          ? {
              ...current,
              attachments: [...current.attachments.filter((item) => item.id !== attachment.id), attachment],
            }
          : current,
      );
      void invalidate({ refreshList: true, deferRegistrationRefresh: variables.deferRegistrationRefresh });
    },
  });
}

export function useRecognizeReceptionCertificate(batchId: string) {
  const client = useQueryClient();
  const invalidate = useInvalidateRegistration(batchId);
  return useMutation({
    retry: 0,
    mutationFn: ({
      attachmentId,
      requestId,
      expectedBatchUpdatedAt,
      includeAllPages,
    }: ReceptionRecognitionRequest & { attachmentId: string; deferRegistrationRefresh?: boolean }) =>
      requestJson<{ run: ReceptionRecognitionRun }>(
        `${registrationUrl(batchId)}/certificates/${encodeURIComponent(attachmentId)}/recognize`,
        { method: "POST", body: JSON.stringify({ requestId, expectedBatchUpdatedAt, includeAllPages }) },
      ),
    onSuccess: ({ run }) => {
      client.setQueryData<ReceptionRegistrationResponse>(queryKeys.receptionRegistration(batchId), (current) =>
        current ? { ...current, runs: [run, ...current.runs.filter((item) => item.id !== run.id)] } : current,
      );
    },
    onSettled: (_data, _error, variables) => {
      void invalidate({ deferRegistrationRefresh: variables.deferRegistrationRefresh });
    },
  });
}

export function useSaveReceptionRegistration(batchId: string) {
  const invalidate = useInvalidateRegistration(batchId);
  return useMutation({
    retry: 0,
    mutationFn: (request: ReceptionRegistrationSaveRequest) =>
      requestJson<{ registration: ReceptionRegistration }>(`${registrationUrl(batchId)}/registration`, {
        method: "PUT",
        body: JSON.stringify(request),
      }),
    onSuccess: () => invalidate({ refreshList: true }),
  });
}
