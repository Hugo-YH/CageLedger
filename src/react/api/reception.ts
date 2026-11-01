import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  ReceptionExportRequest,
  ReceptionFilterColumn,
  ReceptionListParams,
  ReceptionListResponse,
  ReceptionPreviewResponse,
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

function useInvalidateRegistration() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.receptionRoot }),
      client.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }),
    ]);
}

export function useUploadReceptionCertificate(batchId: string) {
  const client = useQueryClient();
  const invalidate = useInvalidateRegistration();
  return useMutation({
    retry: 0,
    mutationFn: ({ file, expectedBatchUpdatedAt }: { file: File; expectedBatchUpdatedAt: string }) => {
      const form = new FormData();
      form.append("file", file);
      const search = new URLSearchParams({ expectedBatchUpdatedAt });
      return requestMultipart<{ attachment: ReceptionCertificateAttachment; reused: boolean }>(
        `${registrationUrl(batchId)}/certificates?${search}`,
        form,
      );
    },
    onSuccess: ({ attachment }) => {
      client.setQueryData<ReceptionRegistrationResponse>(queryKeys.receptionRegistration(batchId), (current) =>
        current
          ? {
              ...current,
              attachments: [...current.attachments.filter((item) => item.id !== attachment.id), attachment],
            }
          : current,
      );
      void invalidate();
    },
  });
}

export function useRecognizeReceptionCertificate(batchId: string) {
  const client = useQueryClient();
  const invalidate = useInvalidateRegistration();
  return useMutation({
    retry: 0,
    mutationFn: ({ attachmentId, ...request }: ReceptionRecognitionRequest & { attachmentId: string }) =>
      requestJson<{ run: ReceptionRecognitionRun }>(
        `${registrationUrl(batchId)}/certificates/${encodeURIComponent(attachmentId)}/recognize`,
        { method: "POST", body: JSON.stringify(request) },
      ),
    onSuccess: ({ run }) => {
      client.setQueryData<ReceptionRegistrationResponse>(queryKeys.receptionRegistration(batchId), (current) =>
        current ? { ...current, runs: [run, ...current.runs.filter((item) => item.id !== run.id)] } : current,
      );
    },
    onSettled: () => {
      void invalidate();
    },
  });
}

export function useSaveReceptionRegistration(batchId: string) {
  const invalidate = useInvalidateRegistration();
  return useMutation({
    retry: 0,
    mutationFn: (request: ReceptionRegistrationSaveRequest) =>
      requestJson<{ registration: ReceptionRegistration }>(`${registrationUrl(batchId)}/registration`, {
        method: "PUT",
        body: JSON.stringify(request),
      }),
    onSuccess: invalidate,
  });
}
