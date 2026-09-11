import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  QuarantineTest,
  QuarantineAttachment,
  QuarantineBatch,
  QuarantineDetail,
  QuarantineMethod,
  QuarantinePage,
  SupplierHistory,
} from "../../contracts/quarantine";
import type { IntakeBatch } from "../../contracts/intake";
import { requestDownload, requestJson } from "./client";
import { uploadFile } from "./administration";
import { queryKeys } from "./queryKeys";

const base = "/api/quarantine";
export function useQuarantineQuery<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.quarantine, path],
    queryFn: ({ signal }) => requestJson<T>(`${base}/${path}`, { signal }),
    enabled,
  });
}
export function useQuarantineBatches(search: string, page: number) {
  return useQuarantineQuery<QuarantinePage<QuarantineBatch>>(
    `batches?search=${encodeURIComponent(search)}&offset=${(page - 1) * 30}`,
  );
}
export function useQuarantineDetail(id: string) {
  return useQuarantineQuery<QuarantineDetail>(`batches/${id}`, Boolean(id));
}
export function useQuarantineSources(from: string, to: string, page: number, enabled: boolean, state = "pending") {
  return useQuarantineQuery<QuarantinePage<IntakeBatch>>(
    `sources?dateFrom=${from}&dateTo=${to}&offset=${(page - 1) * 30}&state=${state}`,
    enabled,
  );
}
export function useQuarantineCatalog() {
  return useQuarantineQuery<{ projects: Record<QuarantineMethod, string[]>; templateVersion: string }>("catalog");
}
export function useSupplierHistory(filters: Record<string, string>, enabled: boolean) {
  return useQuarantineQuery<{ items: SupplierHistory[] }>(`suppliers?${new URLSearchParams(filters)}`, enabled);
}
export function useQuarantineWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
      file,
    }: {
      path: string;
      body?: object;
      method?: "POST" | "PUT";
      file?: File;
    }) =>
      file
        ? uploadFile<{ item: { id: string } }>(`${base}/${path}`, file)
        : requestJson<{ item: { id: string } }>(`${base}/${path}`, { method, body: JSON.stringify(body ?? {}) }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.quarantine }),
        client.invalidateQueries({ queryKey: queryKeys.intakeRoot }),
      ]),
  });
}
export function downloadQuarantine(path: string) {
  return requestDownload(`${base}/${path}`);
}

export function useQuarantineRecordSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ item, version }: { item: QuarantineTest; version: string }) =>
      requestJson<{ item: QuarantineTest }>(`${base}/tests${version ? `/${item.id}` : ""}`, {
        method: version ? "PUT" : "POST",
        body: JSON.stringify({ item, expectedUpdatedAt: version }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.quarantine }),
  });
}
export function useQuarantineAttachmentWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, file, body }: { path: string; file?: File; body?: object }) =>
      file
        ? uploadFile<{ item: QuarantineAttachment; test: QuarantineTest }>(`${base}/${path}`, file)
        : requestJson<{ item: QuarantineAttachment; test: QuarantineTest }>(`${base}/${path}`, {
            method: "PUT",
            body: JSON.stringify(body),
          }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.quarantine }),
  });
}
