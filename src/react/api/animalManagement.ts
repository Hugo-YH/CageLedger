import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnimalInspectionEdit,
  AnimalInspectionDisplay,
  InspectionCatalogSummary,
} from "../../contracts/animalManagement";

import type {
  AnimalInspection,
  AnimalInspectionDetail,
  AnimalInspectionSummary,
  AnimalInspectionListParams,
  FindingStatus,
  InspectionAnswer,
  InspectionCatalogDraftResponse,
  InspectionCatalogResponse,
  InspectionCatalogVersionSummary,
  InspectionFinding,
  InspectionFindingSummary,
} from "./contracts";
import { uploadFile } from "./administration";
import { requestDownload, requestJson, requestMultipart } from "./client";
import { queryKeys } from "./queryKeys";

function url(path: string, params: object) {
  const search = new URLSearchParams();
  Object.entries(params as Record<string, string | number | undefined>).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  return `${path}${search.size ? `?${search.toString()}` : ""}`;
}

export function useAnimalInspectionCatalog() {
  return useQuery({
    queryKey: queryKeys.animalInspectionCatalog,
    queryFn: ({ signal }) => requestJson<InspectionCatalogResponse>("/api/animal-inspection-catalog", { signal }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAnimalInspectionCatalogSummary(
  projectFull: (value: InspectionCatalogResponse) => InspectionCatalogSummary,
) {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.animalInspectionCatalogSummary,
    initialData: () => {
      const full = client.getQueryState<InspectionCatalogResponse>(queryKeys.animalInspectionCatalog);
      return full?.data && !full.isInvalidated && Date.now() - full.dataUpdatedAt < 5 * 60 * 1000
        ? projectFull(full.data)
        : undefined;
    },
    initialDataUpdatedAt: () => client.getQueryState(queryKeys.animalInspectionCatalog)?.dataUpdatedAt,
    queryFn: ({ signal }) => {
      const state = client.getQueryState<InspectionCatalogResponse>(queryKeys.animalInspectionCatalog);
      if (state?.data && !state.isInvalidated && Date.now() - state.dataUpdatedAt < 5 * 60 * 1000)
        return projectFull(state.data);
      return requestJson<InspectionCatalogSummary>("/api/animal-inspection-catalog?view=summary", { signal });
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAnimalInspectionCatalogDraft(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.animalInspectionCatalogDraft,
    queryFn: ({ signal }) =>
      requestJson<InspectionCatalogDraftResponse>("/api/animal-inspection-catalog/draft", { signal }),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useAnimalInspectionCatalogDraftStatus(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.animalInspectionCatalogDraftStatus,
    queryFn: ({ signal }) =>
      requestJson<{ hasDraft: boolean; updatedAt: string }>("/api/animal-inspection-catalog/draft/status", { signal }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveInspectionCatalogDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      modules: InspectionCatalogResponse["modules"];
      nodes: InspectionCatalogResponse["nodes"];
      expectedUpdatedAt: string;
    }) =>
      requestJson<InspectionCatalogDraftResponse>("/api/animal-inspection-catalog/draft", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: (payload) => {
      client.setQueryData(queryKeys.animalInspectionCatalogDraft, payload);
      void client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogDraftStatus });
    },
  });
}

export function usePublishInspectionCatalogDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      requestJson<InspectionCatalogResponse>("/api/animal-inspection-catalog/draft/publish", { method: "POST" }),
    onSuccess: async (payload) => {
      client.setQueryData(queryKeys.animalInspectionCatalog, payload);
      await client.cancelQueries({ queryKey: queryKeys.animalInspectionCatalogSummary, exact: true });
      await client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogSummary, exact: true });
      void client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogDraft });
      void client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogDraftStatus });
    },
  });
}

export function useAnimalInspectionCatalogVersions(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.animalInspectionCatalogVersions,
    queryFn: ({ signal }) =>
      requestJson<{ items: InspectionCatalogVersionSummary[] }>("/api/animal-inspection-catalog/versions", { signal }),
    staleTime: 30 * 1000,
    enabled,
  });
}

export function useRestoreInspectionCatalogVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (version: string) =>
      requestJson<InspectionCatalogResponse>(
        `/api/animal-inspection-catalog/versions/${encodeURIComponent(version)}/restore`,
        {
          method: "POST",
        },
      ),
    onSuccess: async (payload) => {
      client.setQueryData(queryKeys.animalInspectionCatalog, payload);
      await client.cancelQueries({ queryKey: queryKeys.animalInspectionCatalogSummary, exact: true });
      await client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogSummary, exact: true });
      void client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogDraft });
      void client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogDraftStatus });
      void client.invalidateQueries({ queryKey: queryKeys.animalInspectionCatalogVersions });
    },
  });
}

export function useUploadInspectionCatalogImage() {
  return useMutation({
    mutationFn: (file: File) =>
      uploadFile<{ ok: boolean; filename: string; url: string }>("/api/animal-inspection-catalog/images", file),
  });
}

export function useAnimalInspections(params: AnimalInspectionListParams) {
  return useQuery({
    queryKey: queryKeys.animalInspections({ ...params }),
    queryFn: ({ signal }) =>
      requestJson<{
        items: AnimalInspectionSummary[];
        page: { offset: number; limit: number; total: number };
        filterOptions: Record<string, string[]>;
      }>(url("/api/animal-inspections", { ...params, view: "summary" }), { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useAnimalInspection(id: string) {
  return useQuery({
    queryKey: queryKeys.animalInspection(id),
    queryFn: ({ signal }) =>
      requestJson<AnimalInspectionDetail>(`/api/animal-inspections/${encodeURIComponent(id)}`, { signal }),
    enabled: Boolean(id),
  });
}
export function useAnimalInspectionEdit(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.animalInspectionView(id, "edit"),
    queryFn: ({ signal }) =>
      requestJson<AnimalInspectionEdit>(`/api/animal-inspections/${encodeURIComponent(id)}?view=edit`, { signal }),
    enabled: Boolean(id) && enabled,
    staleTime: 0,
  });
}
export function useAnimalInspectionDisplay(id: string) {
  return useQuery({
    queryKey: queryKeys.animalInspectionView(id, "display"),
    queryFn: ({ signal }) =>
      requestJson<AnimalInspectionDisplay>(`/api/animal-inspections/${encodeURIComponent(id)}?view=display`, {
        signal,
      }),
    enabled: Boolean(id),
  });
}

export function useAnimalFindings(
  params: Pick<AnimalInspectionListParams, "limit" | "offset" | "room" | "status" | "severity">,
) {
  return useQuery({
    queryKey: queryKeys.animalFindings({ ...params }),
    queryFn: ({ signal }) =>
      requestJson<{ items: InspectionFindingSummary[]; page: { offset: number; limit: number; total: number } }>(
        url("/api/animal-inspection-findings", { ...params, view: "summary" }),
        { signal },
      ),
    placeholderData: (previous) => previous,
  });
}

export function useRefreshAnimalInspections() {
  const client = useQueryClient();
  return () => {
    return Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.animalInspectionsRoot }),
      client.invalidateQueries({ queryKey: queryKeys.animalFindingsRoot }),
    ]);
  };
}

export function useSaveAnimalInspection() {
  const invalidate = useRefreshAnimalInspections();
  return useMutation({
    mutationFn: ({
      id,
      roomId,
      moduleCodes,
      answers,
      expectedUpdatedAt,
    }: {
      id?: string;
      roomId: string;
      moduleCodes: string[];
      answers: InspectionAnswer[];
      expectedUpdatedAt?: string;
      deferInvalidate?: boolean;
    }) =>
      requestJson<{ item: AnimalInspection }>(
        id ? `/api/animal-inspections/${encodeURIComponent(id)}` : "/api/animal-inspections",
        {
          method: id ? "PUT" : "POST",
          body: JSON.stringify({ roomId, moduleCodes, answers, expectedUpdatedAt }),
        },
      ),
    onSuccess: (_result, variables) => (variables.deferInvalidate ? undefined : invalidate()),
  });
}

export function useSubmitAnimalInspection() {
  const invalidate = useRefreshAnimalInspections();
  return useMutation({
    mutationFn: (input: string | { id: string; expectedUpdatedAt?: string; deferInvalidate?: boolean }) =>
      requestJson<{ item: AnimalInspection; findings: InspectionFinding[] }>(
        `/api/animal-inspections/${encodeURIComponent(typeof input === "string" ? input : input.id)}/submit`,
        {
          method: "POST",
          ...(typeof input === "string"
            ? {}
            : { body: JSON.stringify({ expectedUpdatedAt: input.expectedUpdatedAt }) }),
        },
      ),
    onSuccess: (_payload, input) => (typeof input !== "string" && input.deferInvalidate ? undefined : invalidate()),
  });
}

export function useUpdateFinding() {
  const invalidate = useRefreshAnimalInspections();
  return useMutation({
    mutationFn: ({
      id,
      status,
      actionNote,
      responsibleName,
      recheckDueAt,
      note,
    }: {
      id: string;
      status: FindingStatus;
      actionNote?: string;
      responsibleName?: string;
      recheckDueAt?: string;
      note?: string;
    }) =>
      requestJson<{ item: InspectionFinding }>(`/api/animal-inspection-findings/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ status, actionNote, responsibleName, recheckDueAt, note }),
      }),
    onSuccess: invalidate,
  });
}

export function useResolveFinding() {
  const invalidate = useRefreshAnimalInspections();
  return useMutation({
    mutationFn: ({ id, conclusion }: { id: string; conclusion: string }) =>
      requestJson<{ item: InspectionFinding }>(`/api/animal-inspection-findings/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ conclusion }),
      }),
    onSuccess: invalidate,
  });
}

export async function uploadAnimalInspectionPhoto(inspectionId: string, findingId: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  return requestMultipart<{ item?: unknown; error?: string }>(
    `/api/animal-inspections/${encodeURIComponent(inspectionId)}/attachments?findingId=${encodeURIComponent(findingId)}`,
    form,
  );
}

export function downloadAnimalInspectionPdf(id: string) {
  return requestDownload(`/api/animal-inspections/${encodeURIComponent(id)}/export-pdf`);
}
