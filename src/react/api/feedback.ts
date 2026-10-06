import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  FeedbackAttachment,
  FeedbackComment,
  FeedbackDetail,
  FeedbackIntegration,
  FeedbackImportPreview,
  FeedbackImportResult,
  FeedbackItem,
  FeedbackKind,
  FeedbackListResponse,
} from "../../contracts/feedback";
import { ApiError, requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export type FeedbackListColumn =
  "number" | "title" | "kind" | "module" | "status" | "author" | "syncStatus" | "encounterCount" | "createdAt";
export type FeedbackFilters = {
  columnFilters: Partial<Record<FeedbackListColumn, string[]>>;
  sortKey: FeedbackListColumn;
  sortDir: "asc" | "desc";
  limit: number;
  offset: number;
};

export function useFeedbackList(filters: FeedbackFilters) {
  return useQuery<FeedbackListResponse>({
    queryKey: queryKeys.feedback(filters),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: ({ signal }) =>
      requestJson<FeedbackListResponse>(
        `/api/feedback?${new URLSearchParams({
          columnFilters: JSON.stringify(filters.columnFilters),
          sortKey: filters.sortKey,
          sortDir: filters.sortDir,
          limit: String(filters.limit),
          offset: String(filters.offset),
        })}`,
        { signal },
      ),
  });
}

export function useFeedbackFilterOptions(
  column: FeedbackListColumn,
  filters: FeedbackFilters["columnFilters"],
  enabled: boolean,
) {
  return useQuery<{ items: Array<{ value: string; label: string; count: number }> }>({
    queryKey: queryKeys.feedbackFilterOptions(column, filters),
    staleTime: 0,
    queryFn: ({ signal }) =>
      requestJson(
        `/api/feedback/filter-options?${new URLSearchParams({ column, columnFilters: JSON.stringify(filters) })}`,
        { signal },
      ),
    enabled,
  });
}

export function useFeedbackDetail(id: string | null, refresh = false) {
  return useQuery<FeedbackDetail>({
    queryKey: queryKeys.feedbackDetail(id || ""),
    queryFn: ({ signal }) => requestJson<FeedbackDetail>(`/api/feedback/${encodeURIComponent(id || "")}`, { signal }),
    enabled: Boolean(id),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2,
    refetchInterval: (query) =>
      refresh && !(query.state.error instanceof ApiError && query.state.error.status === 404) ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useFeedbackIntegration(enabled: boolean) {
  return useQuery<FeedbackIntegration>({
    queryKey: queryKeys.feedbackIntegration,
    queryFn: ({ signal }) => requestJson<FeedbackIntegration>("/api/feedback/integration", { signal }),
    enabled,
    retry: false,
  });
}

export function useFeedbackImportPreview(state: "all" | "open" | "closed", page: number, enabled: boolean) {
  return useQuery<FeedbackImportPreview>({
    queryKey: queryKeys.feedbackImport(state, page),
    queryFn: ({ signal }) =>
      requestJson(`/api/feedback/import/preview?${new URLSearchParams({ state, page: String(page) })}`, { signal }),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

export function useImportFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { requestId: string; repository: string; numbers: number[] }) =>
      requestJson<FeedbackImportResult>("/api/feedback/import", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.feedbackRoot }),
  });
}

export function useCreateFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      requestId: string;
      title: string;
      kind: FeedbackKind;
      module: string;
      description: string;
      environment: FeedbackItem["environment"];
    }) => requestJson<{ item: FeedbackItem }>("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.feedbackRoot }),
  });
}

export function useAddFeedbackComment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { requestId: string; body: string }) =>
      requestJson<{ item: FeedbackComment }>(`/api/feedback/${encodeURIComponent(id)}/comments`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.feedbackRoot });
    },
  });
}

export function useSetFeedbackEncounter(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (encountered: boolean) =>
      requestJson<{ item: FeedbackItem }>(`/api/feedback/${encodeURIComponent(id)}/encounter`, {
        method: "PUT",
        body: JSON.stringify({ encountered }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.feedbackRoot });
    },
  });
}

export function useQueueFeedbackSync(id: string, retry = false) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      requestJson<{ queued: boolean }>(`/api/feedback/${encodeURIComponent(id)}/${retry ? "retry" : "sync"}`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.feedbackRoot });
    },
  });
}

export async function uploadFeedbackAttachment(id: string, requestId: string, file: File, commentId?: string) {
  const query = new URLSearchParams({ requestId });
  if (commentId) query.set("commentId", commentId);
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`/api/feedback/${encodeURIComponent(id)}/attachments?${query}`, {
    method: "POST",
    body,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as { item?: FeedbackAttachment; error?: string };
  if (!response.ok || !payload.item) throw new Error(payload.error || `上传失败 (${response.status})`);
  return payload.item;
}
