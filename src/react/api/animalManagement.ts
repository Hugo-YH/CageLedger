import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  AnimalInspection,
  AnimalInspectionDetail,
  AnimalInspectionListParams,
  FindingStatus,
  InspectionAnswer,
  InspectionCatalogResponse,
  InspectionFinding,
} from "./contracts";
import { requestDownload, requestJson } from "./client";
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
    queryFn: () => requestJson<InspectionCatalogResponse>("/api/animal-inspection-catalog"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAnimalInspections(params: AnimalInspectionListParams) {
  return useQuery({
    queryKey: queryKeys.animalInspections(params as unknown as Record<string, unknown>),
    queryFn: () =>
      requestJson<{
        items: AnimalInspection[];
        page: { offset: number; limit: number; total: number };
        filterOptions: Record<string, string[]>;
      }>(url("/api/animal-inspections", params)),
    placeholderData: (previous) => previous,
  });
}

export function useAnimalInspection(id: string) {
  return useQuery({
    queryKey: queryKeys.animalInspection(id),
    queryFn: () => requestJson<AnimalInspectionDetail>(`/api/animal-inspections/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

export function useAnimalFindings(
  params: Pick<AnimalInspectionListParams, "limit" | "offset" | "room" | "status" | "severity">,
) {
  return useQuery({
    queryKey: queryKeys.animalFindings(params as Record<string, unknown>),
    queryFn: () =>
      requestJson<{ items: InspectionFinding[]; page: { offset: number; limit: number; total: number } }>(
        url("/api/animal-inspection-findings", params),
      ),
    placeholderData: (previous) => previous,
  });
}

function useInvalidateAnimalInspections() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.animalInspectionsRoot });
    void client.invalidateQueries({ queryKey: queryKeys.animalFindingsRoot });
  };
}

export function useSaveAnimalInspection() {
  const invalidate = useInvalidateAnimalInspections();
  return useMutation({
    mutationFn: ({
      id,
      roomId,
      moduleCodes,
      answers,
    }: {
      id?: string;
      roomId: string;
      moduleCodes: string[];
      answers: InspectionAnswer[];
    }) =>
      requestJson<{ item: AnimalInspection }>(
        id ? `/api/animal-inspections/${encodeURIComponent(id)}` : "/api/animal-inspections",
        {
          method: id ? "PUT" : "POST",
          body: JSON.stringify({ roomId, moduleCodes, answers }),
        },
      ),
    onSuccess: invalidate,
  });
}

export function useSubmitAnimalInspection() {
  const invalidate = useInvalidateAnimalInspections();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      requestJson<{ item: AnimalInspection; findings: InspectionFinding[] }>(
        `/api/animal-inspections/${encodeURIComponent(id)}/submit`,
        { method: "POST" },
      ),
    onSuccess: (payload) => {
      invalidate();
      void client.invalidateQueries({ queryKey: queryKeys.animalInspection(payload.item.id) });
    },
  });
}

export function useUpdateFinding() {
  const invalidate = useInvalidateAnimalInspections();
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
  const invalidate = useInvalidateAnimalInspections();
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
  const response = await fetch(
    `/api/animal-inspections/${encodeURIComponent(inspectionId)}/attachments?findingId=${encodeURIComponent(findingId)}`,
    {
      method: "POST",
      body: form,
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `上传失败 (${response.status})`);
  return payload;
}

export function downloadAnimalInspectionPdf(id: string) {
  return requestDownload(`/api/animal-inspections/${encodeURIComponent(id)}/export-pdf`);
}
