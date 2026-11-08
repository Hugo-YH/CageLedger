import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  Researcher,
  ResearcherContact,
  ResearcherEditable,
  ResearcherImportFile,
  ResearcherImportPreview,
  ResearcherImportRequest,
  ResearcherImportResult,
  ResearcherListParams,
  ResearcherListResponse,
} from "../../contracts/researchers";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import { mutationActor, publishMutationItem } from "./mutationCache";

export function resolveResearcherContacts(names: string[], signal?: AbortSignal) {
  return requestJson<{ items: ResearcherContact[] }>("/api/researchers/contacts/resolve", {
    method: "POST",
    body: JSON.stringify({ names }),
    ...(signal ? { signal } : {}),
  });
}

export function useResearchers(params: ResearcherListParams) {
  return useQuery({
    queryKey: queryKeys.researchers(params),
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
      if (params.q) search.set("q", params.q);
      if (params.department) search.set("department", params.department);
      return requestJson<ResearcherListResponse>(`/api/researchers?${search}`, { signal });
    },
  });
}

export function useResearcher(id: string) {
  return useQuery({
    queryKey: queryKeys.researcher(id),
    queryFn: ({ signal }) =>
      requestJson<{ item: Researcher }>(`/api/researchers/${encodeURIComponent(id)}`, { signal }),
  });
}

function useRefreshResearchers() {
  const client = useQueryClient();
  return async () => {
    // A failed refresh cannot turn a completed write into a failed operation.
    await Promise.allSettled([
      client.invalidateQueries({ queryKey: queryKeys.researchersRoot }, { throwOnError: false }),
      client.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }, { throwOnError: false }),
    ]);
  };
}

export function useSaveResearcher() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      item,
      expectedUpdatedAt,
    }: {
      id: string;
      item: ResearcherEditable;
      expectedUpdatedAt: string;
    }) =>
      requestJson<{ item: Researcher }>(`/api/researchers/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ item, expectedUpdatedAt }),
      }),
    onMutate: () => ({ actor: mutationActor(client) }),
    onSuccess: async (response, { id }, context) => {
      if (!(await publishMutationItem(client, context?.actor, queryKeys.researcher(id), response))) return;
      // The PUT already returns the complete target. Lists also own department
      // options; invalidate their active and inactive scopes, not this detail.
      await Promise.allSettled([
        client.invalidateQueries(
          { queryKey: queryKeys.researchersRoot, predicate: (query) => query.queryKey[1] === "list" },
          { throwOnError: false },
        ),
        client.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }, { throwOnError: false }),
      ]);
    },
  });
}

export function usePreviewResearcherImport() {
  return useMutation({
    mutationFn: (file: ResearcherImportFile) =>
      requestJson<ResearcherImportPreview>("/api/researchers/import/preview", {
        method: "POST",
        body: JSON.stringify(file),
      }),
  });
}

export function useImportResearchers() {
  const refresh = useRefreshResearchers();
  return useMutation({
    mutationFn: (payload: ResearcherImportRequest) =>
      requestJson<ResearcherImportResult>("/api/researchers/import", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: refresh,
  });
}
