import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  useAddFeedbackComment,
  useCreateFeedback,
  useFeedbackDetail,
  useFeedbackFilterOptions,
  useFeedbackImportPreview,
  useFeedbackIntegration,
  useFeedbackList,
  useImportFeedback,
  useQueueFeedbackSync,
  useSetFeedbackEncounter,
  type FeedbackFilters,
} from "./feedback";
import { queryKeys } from "./queryKeys";
import type { FeedbackDetail, FeedbackItem } from "../../contracts/feedback";

const clients: QueryClient[] = [];
const filters: FeedbackFilters = { columnFilters: {}, sortKey: "number", sortDir: "desc", limit: 20, offset: 0 };
const item: FeedbackItem = {
  id: "feedback-1",
  number: 1,
  title: "性能回归",
  kind: "bug",
  module: "反馈",
  description: "完整正文",
  status: "pending",
  syncStatus: "pending",
  createdBy: { id: "user", name: "用户" },
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-07T00:00:00Z",
  encounterCount: 0,
  encountered: false,
  assignees: [],
  fixVersion: "",
  lastSyncedAt: "",
  environment: { appVersion: "test", build: "test", page: "feedback", browser: "test" },
  issueNumber: null,
  version: 1,
};
const detail: FeedbackDetail = { item, comments: [], attachments: [] };

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function json(value: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { headers });
}

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("requests an independently keyed summary while leaving full-list cache entries intact", async () => {
  const { client, wrapper } = setup();
  const full = { items: [item], total: 1, limit: 20, offset: 0 };
  client.setQueryData(queryKeys.feedback(filters), full);
  const summary: Partial<FeedbackItem> = { ...item };
  delete summary.description;
  delete summary.environment;
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ...full, items: [summary] }));
  const { result } = renderHook(() => useFeedbackList(filters), { wrapper });
  await waitFor(() => expect(result.current.data?.items[0].id).toBe(item.id));
  const url = new URL(String(fetch.mock.calls[0][0]), "http://localhost");
  expect(url.searchParams.get("view")).toBe("summary");
  expect(url.searchParams.get("columnFilters")).toBe("{}");
  expect(result.current.data?.items[0]).not.toHaveProperty("description");
  expect(client.getQueryData(queryKeys.feedback(filters))).toBe(full);
  expect(client.getQueryData(queryKeys.feedbackSummary(filters))).toEqual({ ...full, items: [summary] });
});

it("reuses a detail's Query-owned ETag on 304 and isolates validators by target and cleared account cache", async () => {
  const { client, wrapper } = setup();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(detail, { ETag: '"one"' }));
  const { result, rerender, unmount } = renderHook(({ id }) => useFeedbackDetail(id, true), {
    wrapper,
    initialProps: { id: item.id },
  });
  await waitFor(() => expect(result.current.data?.item.id).toBe(item.id));
  const previous = result.current.data;
  const notModified = new Response(null, { status: 304 });
  const parse = vi.spyOn(notModified, "json");
  fetch.mockResolvedValueOnce(notModified);
  await act(async () => {
    await result.current.refetch();
  });
  expect(parse).not.toHaveBeenCalled();
  expect(result.current.data).toBe(previous);
  expect(new Headers(fetch.mock.calls[1][1]?.headers).get("If-None-Match")).toBe('"one"');
  fetch.mockResolvedValueOnce(json({ ...detail, item: { ...item, id: "feedback-2" } }, { ETag: '"two"' }));
  rerender({ id: "feedback-2" });
  await waitFor(() => expect(result.current.data?.item.id).toBe("feedback-2"));
  expect(new Headers(fetch.mock.calls[2][1]?.headers).has("If-None-Match")).toBe(false);
  unmount();
  client.clear();
  fetch.mockResolvedValueOnce(json(detail));
  const reopened = renderHook(() => useFeedbackDetail(item.id), { wrapper });
  await waitFor(() => expect(reopened.result.current.data?.item.id).toBe(item.id));
  expect(new Headers(fetch.mock.calls[3][1]?.headers).has("If-None-Match")).toBe(false);
});

it("keeps 404 as an error with cached detail and stops the five-second polling immediately", async () => {
  const { wrapper } = setup();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(detail, { ETag: '"one"' }));
  const { result } = renderHook(
    () => {
      const query = useFeedbackDetail(item.id, true);
      // Subscribe during render just like the drawer's 404 boundary. A refetch
      // error retains data, so observing only data would keep the prior result.
      return { data: query.data, error: query.error, isError: query.isError, refetch: query.refetch };
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.data?.item.id).toBe(item.id));
  fetch.mockResolvedValueOnce(new Response('{"error":"反馈不存在"}', { status: 404 }));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.error).toMatchObject({ status: 404 }));
  expect(result.current.isError).toBe(true);
  // The drawer's existing 404 boundary hides this retained data; never treat 404 as 304.
  expect(result.current.data?.item.id).toBe(item.id);
  vi.useFakeTimers();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps the five/fifteen/thirty second foreground schedules and pauses them while unfocused", async () => {
  const { wrapper } = setup();
  const counts = { detail: 0, integration: 0, list: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path.endsWith("integration")) {
      counts.integration += 1;
      return Promise.resolve(json({ configured: false }));
    }
    if (path === "/api/feedback") {
      counts.list += 1;
      return Promise.resolve(json({ items: [], total: 0, limit: 20, offset: 0 }));
    }
    counts.detail += 1;
    return Promise.resolve(json(detail));
  });
  const { result } = renderHook(
    () => ({
      detail: useFeedbackDetail(item.id, true),
      integration: useFeedbackIntegration(true),
      list: useFeedbackList(filters),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(
      result.current.detail.isSuccess && result.current.integration.isSuccess && result.current.list.isSuccess,
    ).toBe(true),
  );
  vi.useFakeTimers();
  // Re-schedule QueryObserver intervals under fake timers.
  focusManager.setFocused(true);
  await act(async () => {
    await result.current.detail.refetch();
    await result.current.integration.refetch();
    await result.current.list.refetch();
  });
  const before = { ...counts };
  for (let step = 0; step < 6; step += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
  }
  expect(counts.detail - before.detail).toBe(6);
  expect(counts.integration - before.integration).toBe(2);
  expect(counts.list - before.list).toBe(1);
  focusManager.setFocused(false);
  const paused = { ...counts };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(counts).toEqual(paused);
});

it("ordinary writes refresh their own detail/list/filter/integration once, preserve inactive staleness, and leave remote import previews alone", async () => {
  const { client, wrapper } = setup();
  const counts = new Map<string, number>();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (init?.method && init.method !== "GET") return Promise.resolve(json({ item, queued: true }));
    counts.set(path, (counts.get(path) || 0) + 1);
    if (path === "/api/feedback") return Promise.resolve(json({ items: [], total: 0, limit: 20, offset: 0 }));
    if (path.endsWith("filter-options")) return Promise.resolve(json({ items: [] }));
    if (path.endsWith("integration")) return Promise.resolve(json({ configured: false }));
    if (path.endsWith("preview"))
      return Promise.resolve(json({ repository: "synthetic", items: [], page: 1, hasMore: false }));
    return Promise.resolve(json(detail));
  });
  const inactiveFilters = { ...filters, offset: 20 };
  client.setQueryData(queryKeys.feedbackSummary(inactiveFilters), { items: [], total: 0, limit: 20, offset: 20 });
  client.setQueryData(queryKeys.feedbackDetail("other"), { value: { item: { id: "other" } }, etag: '"other"' });
  const { result } = renderHook(
    () => ({
      list: useFeedbackList(filters),
      detail: useFeedbackDetail(item.id),
      integration: useFeedbackIntegration(true),
      preview: useFeedbackImportPreview("all", 1, true),
      facet: useFeedbackFilterOptions("module", {}, true),
      encounter: useSetFeedbackEncounter(item.id),
      sync: useQueueFeedbackSync(item.id, true),
      create: useCreateFeedback(),
      comment: useAddFeedbackComment(item.id),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(
      [
        result.current.list,
        result.current.detail,
        result.current.integration,
        result.current.preview,
        result.current.facet,
      ].every((query) => query.isSuccess),
    ).toBe(true),
  );
  const paths = [
    "/api/feedback",
    `/api/feedback/${item.id}`,
    "/api/feedback/integration",
    "/api/feedback/filter-options",
  ];
  const actions = [
    () => result.current.encounter.mutateAsync(true),
    () => result.current.sync.mutateAsync(),
    () =>
      result.current.create.mutateAsync({
        requestId: "create-request",
        title: "title",
        description: "body",
        kind: "bug" as const,
        module: "feedback",
        environment: item.environment,
      }),
    () => result.current.comment.mutateAsync({ requestId: "comment-request", body: "body" }),
  ];
  for (const action of actions) {
    const before = paths.map((path) => counts.get(path) || 0);
    await act(async () => {
      await action();
    });
    await waitFor(() => {
      expect(paths.map((path) => counts.get(path) || 0)).toEqual(before.map((count) => count + 1));
      expect(
        [result.current.list, result.current.detail, result.current.integration, result.current.facet].some(
          (query) => query.isFetching,
        ),
      ).toBe(false);
    });
    expect(counts.get("/api/feedback/import/preview")).toBe(1);
  }
  expect(client.getQueryState(queryKeys.feedbackSummary(inactiveFilters))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.feedbackDetail("other"))?.isInvalidated).toBe(false);
  expect(fetch.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toHaveLength(4);
});

it("an import also invalidates inactive preview pages while refreshing the current page once", async () => {
  const { client, wrapper } = setup();
  let reads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    if (init?.method === "POST")
      return Promise.resolve(json({ items: [{ number: 1, outcome: "imported", feedbackId: item.id }] }));
    reads += 1;
    return Promise.resolve(json({ repository: "synthetic", items: [], page: 1, hasMore: false }));
  });
  client.setQueryData(queryKeys.feedbackImport("all", 2), {
    repository: "synthetic",
    items: [],
    page: 2,
    hasMore: false,
  });
  const { result } = renderHook(
    () => ({ preview: useFeedbackImportPreview("all", 1, true), importing: useImportFeedback() }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));
  await act(async () => {
    await result.current.importing.mutateAsync({ requestId: "import-request", repository: "synthetic", numbers: [1] });
  });
  expect(reads).toBe(2);
  expect(client.getQueryState(queryKeys.feedbackImport("all", 2))?.isInvalidated).toBe(true);
});
