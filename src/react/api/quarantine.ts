import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  QuarantineTest,
  QuarantineAttachment,
  QuarantineBatch,
  QuarantineDetail,
  QuarantineOverview,
  QuarantineTestDetail,
  QuarantineMethod,
  QuarantinePage,
  SupplierHistory,
  SupplierHistorySummary,
  SupplierHistoryDetail,
} from "../../contracts/quarantine";
import type { IntakeBatchListItem } from "../../contracts/intake";
import { requestDownload, requestJson } from "./client";
import { uploadFile } from "./administration";
import { queryKeys } from "./queryKeys";

const base = "/api/quarantine";
export function useQuarantineQuery<T>(path: string, enabled = true, retainList = false) {
  return useQuery({
    queryKey: [...queryKeys.quarantine, path],
    queryFn: ({ signal }) => requestJson<T>(`${base}/${path}`, { signal }),
    enabled,
    placeholderData: (previous, previousQuery) => {
      const previousPath = String(previousQuery?.queryKey.at(-1));
      const sameMethod =
        new URLSearchParams(previousPath.split("?")[1]).get("method") ===
        new URLSearchParams(path.split("?")[1]).get("method");
      return retainList && sameMethod && previousPath.split("?")[0] === path.split("?")[0] ? previous : undefined;
    },
  });
}
export function useQuarantineBatches(
  search: string,
  page: number,
  enabled = true,
  method?: QuarantineMethod | "elisa",
  state = "",
) {
  return useQuarantineQuery<QuarantinePage<QuarantineBatch>>(
    `batches?search=${encodeURIComponent(search)}&offset=${(page - 1) * 30}${method ? `&method=${method}` : ""}&state=${state}`,
    enabled,
    true,
  );
}
export function useQuarantineDetail(id: string) {
  return useQuarantineQuery<QuarantineDetail>(`batches/${id}`, Boolean(id));
}
export function useQuarantineOverview(id: string) {
  return useQuarantineQuery<QuarantineOverview>(`batches/${id}?view=overview`, Boolean(id));
}
export function useQuarantineTestDetail(id: string) {
  return useQuarantineQuery<QuarantineTestDetail>(`tests/${id}`, Boolean(id));
}

function invalidateQuarantine(
  client: QueryClient,
  { batchId, testId, sources = false }: { batchId?: string; testId?: string; sources?: boolean },
) {
  return Promise.all([
    client.invalidateQueries({
      predicate: (query) => {
        if (query.queryKey[0] !== queryKeys.quarantine[0]) return false;
        const path = String(query.queryKey.at(-1)).split("?")[0];
        if (["batches", "records", "reports", "suppliers", "suppliers/summary", "suppliers/details"].includes(path))
          return true;
        if (path === "sources") return sources;
        if (batchId && (path === `batches/${batchId}` || path === `batches/${batchId}/activity`)) return true;
        return Boolean(testId && path === `tests/${testId}`);
      },
    }),
    ...(sources ? [client.invalidateQueries({ queryKey: queryKeys.intakeRoot })] : []),
  ]);
}

async function updateTest(client: QueryClient, item: QuarantineTest, attachment?: QuarantineAttachment) {
  const queryKey = [...queryKeys.quarantine, `tests/${item.id}`];
  await client.cancelQueries({ queryKey, exact: true });
  client.setQueryData<QuarantineTestDetail>(queryKey, (current) => ({
    item,
    reports: current?.reports ?? [],
    attachments: attachment
      ? [...(current?.attachments ?? []).filter((entry) => entry.id !== attachment.id), attachment]
      : (current?.attachments ?? []),
  }));
}
export function quarantineSourcesPath(from: string, to: string, page: number, state = "pending") {
  return `sources?view=summary&dateFrom=${from}&dateTo=${to}&offset=${(page - 1) * 30}&state=${state}`;
}
export function useQuarantineSources(from: string, to: string, page: number, enabled: boolean, state = "pending") {
  return useQuarantineQuery<QuarantinePage<IntakeBatchListItem>>(
    quarantineSourcesPath(from, to, page, state),
    enabled,
    true,
  );
}
export function useQuarantineCatalog(enabled = true) {
  return useQuarantineQuery<{ projects: Record<QuarantineMethod, string[]>; templateVersion: string }>(
    "catalog",
    enabled,
  );
}
export function useSupplierHistory(filters: Record<string, string>, enabled: boolean) {
  return useQuarantineQuery<{ items: SupplierHistory[] }>(`suppliers?${new URLSearchParams(filters)}`, enabled, true);
}
export function supplierSummaryPath(filters: Record<string, string>, page: number) {
  const params = new URLSearchParams({ ...filters, limit: "10", offset: String((page - 1) * 10) });
  return `suppliers/summary?${params}`;
}
export function useSupplierHistorySummary(filters: Record<string, string>, page: number) {
  return useQuarantineQuery<QuarantinePage<SupplierHistorySummary>>(supplierSummaryPath(filters, page), true, true);
}
export function supplierDetailsPath(filters: Record<string, string>, group: SupplierHistorySummary, page: number) {
  const params = new URLSearchParams({
    ...filters,
    groupSupplier: group.supplier,
    groupMethod: group.method,
    groupRetest: String(group.retest),
    limit: "10",
    offset: String((page - 1) * 10),
  });
  return `suppliers/details?${params}`;
}
export function useSupplierHistoryDetails(
  filters: Record<string, string>,
  group: SupplierHistorySummary,
  page: number,
) {
  return useQuarantineQuery<QuarantinePage<SupplierHistoryDetail>>(
    supplierDetailsPath(filters, group, page),
    true,
    true,
  );
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
      method?: "POST" | "PUT" | "DELETE";
      file?: File;
      batchId?: string;
    }) =>
      file
        ? uploadFile<{ item: { id: string } }>(`${base}/${path}`, file)
        : requestJson<{ item: { id: string } }>(`${base}/${path}`, { method, body: JSON.stringify(body ?? {}) }),
    onSuccess: (_result, variables) => {
      const parts = variables.path.split("/");
      const item = (variables.body as { item?: { id?: string } } | undefined)?.item;
      return invalidateQuarantine(client, {
        batchId: variables.batchId || (parts[0] === "batches" ? parts[1] || item?.id : undefined),
        testId: parts[0] === "tests" ? parts[1] : undefined,
        sources: true,
      });
    },
  });
}
export function downloadQuarantine(path: string) {
  return requestDownload(`${base}/${path}`);
}

export function useQuarantineRecordSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ item, version }: { item: QuarantineTest; version: string; deferRefresh?: boolean }) =>
      requestJson<{ item: QuarantineTest }>(`${base}/tests${version ? `/${item.id}` : ""}`, {
        method: version ? "PUT" : "POST",
        body: JSON.stringify({ item, expectedUpdatedAt: version }),
      }),
    onSuccess: async ({ item }, variables) => {
      await updateTest(client, item);
      if (!variables.deferRefresh) return invalidateQuarantine(client, { batchId: item.batchId });
    },
  });
}
export function useQuarantineAttachmentWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      file,
      body,
    }: {
      path: string;
      file?: File;
      body?: object;
      batchId: string;
      testId: string;
    }) =>
      file
        ? uploadFile<{ item: QuarantineAttachment; test: QuarantineTest }>(`${base}/${path}`, file)
        : requestJson<{ item: QuarantineAttachment; test: QuarantineTest }>(`${base}/${path}`, {
            method: "PUT",
            body: JSON.stringify(body),
          }),
    onSuccess: ({ item, test }) => updateTest(client, test, item),
    onSettled: (_result, error, variables) =>
      invalidateQuarantine(client, { batchId: variables.batchId, testId: error ? variables.testId : undefined }),
  });
}
