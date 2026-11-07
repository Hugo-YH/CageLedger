import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type {
  FeedbackAttachment,
  FeedbackComment,
  FeedbackDetail,
  FeedbackIntegration,
  FeedbackImportPreview,
  FeedbackImportResult,
  FeedbackItem,
  FeedbackSummaryResponse,
  FeedbackSubmission,
} from "../../contracts/feedback";
import { ApiError, requestConditionalJson, requestJson, requestMultipart, type ConditionalJson } from "./client";
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
  return useQuery<FeedbackSummaryResponse>({
    queryKey: queryKeys.feedbackSummary(filters),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: ({ signal }) =>
      requestJson<FeedbackSummaryResponse>(
        `/api/feedback?${new URLSearchParams({
          view: "summary",
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
  const client = useQueryClient();
  const key = queryKeys.feedbackDetail(id || "");
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      requestConditionalJson<FeedbackDetail>(
        `/api/feedback/${encodeURIComponent(id || "")}`,
        client.getQueryData<ConditionalJson<FeedbackDetail>>(key),
        signal,
      ),
    select: selectFeedbackDetail,
    enabled: Boolean(id),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2,
    refetchInterval: (query) =>
      refresh && !(query.state.error instanceof ApiError && query.state.error.status === 404) ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
}

function selectFeedbackDetail(response: ConditionalJson<FeedbackDetail>) {
  return response.value;
}

/** Keep unrelated remote import previews out of ordinary feedback writes. */
function refreshFeedbackQueries(client: QueryClient, id?: string, includeImports = false) {
  return client.invalidateQueries({
    queryKey: queryKeys.feedbackRoot,
    predicate: ({ queryKey }) =>
      ["list", "filter-options", "integration"].includes(String(queryKey[1])) ||
      (queryKey[1] === "detail" && (!id || queryKey[2] === id)) ||
      (includeImports && queryKey[1] === "import"),
  });
}

/** A create/comment and its attachment uploads publish one final refresh. */
export function useRefreshFeedback() {
  const client = useQueryClient();
  return useCallback((id?: string) => refreshFeedbackQueries(client, id), [client]);
}

type FeedbackWriteOptions = { refresh?: boolean };

export function useFeedbackIntegration(enabled: boolean) {
  return useQuery<FeedbackIntegration>({
    queryKey: queryKeys.feedbackIntegration,
    queryFn: ({ signal }) => requestJson<FeedbackIntegration>("/api/feedback/integration", { signal }),
    enabled,
    retry: false,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
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
    onSuccess: () => refreshFeedbackQueries(client, undefined, true),
  });
}

export function useCreateFeedback(options: FeedbackWriteOptions = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: FeedbackSubmission) =>
      requestJson<{ item: FeedbackItem }>("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: ({ item }) => (options.refresh === false ? undefined : refreshFeedbackQueries(client, item.id)),
  });
}

export function useAddFeedbackComment(id: string, options: FeedbackWriteOptions = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { requestId: string; body: string }) =>
      requestJson<{ item: FeedbackComment }>(`/api/feedback/${encodeURIComponent(id)}/comments`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      if (options.refresh !== false) void refreshFeedbackQueries(client, id);
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
      void refreshFeedbackQueries(client, id);
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
      void refreshFeedbackQueries(client, id);
    },
  });
}

export async function uploadFeedbackAttachment(id: string, requestId: string, file: File, commentId?: string) {
  const query = new URLSearchParams({ requestId });
  if (commentId) query.set("commentId", commentId);
  const body = new FormData();
  body.set("file", file);
  const payload = await requestMultipart<{ item?: FeedbackAttachment; error?: string }>(
    `/api/feedback/${encodeURIComponent(id)}/attachments?${query}`,
    body,
  );
  if (!payload.item)
    throw new ApiError(payload.error || "附件上传响应缺少信息，请刷新后重试", 200, payload, {
      code: "INVALID_RESPONSE",
    });
  return payload.item;
}
