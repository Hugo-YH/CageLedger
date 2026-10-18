import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { useDashboardOverview } from "./dashboardOverview";
import { queryKeys } from "./queryKeys";
import {
  useConfirmIntakeBatch,
  useConfirmIntakeBatchesReceipt,
  useDeleteIntakeBatch,
  useMarkIntakeBatchesPrinted,
  useSaveIntakeBatch,
} from "./intake";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

it("revalidates the same month while keeping validators isolated by query and account cache", async () => {
  const { client, wrapper } = setup();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response('{"month":"2026-09"}', { headers: { ETag: '"sep"' } }));
  const { result, rerender, unmount } = renderHook(({ month }) => useDashboardOverview(month), {
    wrapper,
    initialProps: { month: "2026-09" },
  });
  await waitFor(() => expect(result.current.data?.month).toBe("2026-09"));
  fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
  await act(async () => {
    await result.current.refetch();
  });
  expect(result.current.data?.month).toBe("2026-09");
  expect(new Headers(fetch.mock.calls[1][1]?.headers).get("If-None-Match")).toBe('"sep"');
  fetch.mockResolvedValueOnce(new Response('{"month":"2026-08"}', { headers: { ETag: '"aug"' } }));
  rerender({ month: "2026-08" });
  await waitFor(() => expect(result.current.data?.month).toBe("2026-08"));
  expect(new Headers(fetch.mock.calls[2][1]?.headers).has("If-None-Match")).toBe(false);
  unmount();
  client.clear();
});

it("rechecks changed data after query invalidation without extending freshness", async () => {
  const { client, wrapper } = setup();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response('{"month":"2026-09","quantitySheetIacucCount":1}', { headers: { ETag: '"one"' } }),
    )
    .mockResolvedValueOnce(
      new Response('{"month":"2026-09","quantitySheetIacucCount":2}', { headers: { ETag: '"two"' } }),
    );
  const { result, unmount } = renderHook(() => useDashboardOverview("2026-09"), { wrapper });
  await waitFor(() => expect(result.current.data?.quantitySheetIacucCount).toBe(1));
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.dashboardOverviewRoot });
  });
  await waitFor(() => expect(result.current.data?.quantitySheetIacucCount).toBe(2));
  expect(fetch).toHaveBeenCalledTimes(2);
  unmount();
  client.clear();
});

it("all intake writes also invalidate inactive dashboard data", async () => {
  const { client, wrapper } = setup();
  client.setQueryData(queryKeys.dashboardOverview("2026-09"), { value: { month: "2026-09" }, etag: '"one"' });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("{}")));
  const { result, unmount } = renderHook(
    () => ({
      save: useSaveIntakeBatch(),
      remove: useDeleteIntakeBatch(),
      confirm: useConfirmIntakeBatch(),
      printed: useMarkIntakeBatchesPrinted(),
      many: useConfirmIntakeBatchesReceipt(),
    }),
    { wrapper },
  );
  const operations = [
    () => result.current.save.mutateAsync({ item: { id: "x" } as never, exists: false }),
    () => result.current.remove.mutateAsync("x"),
    () => result.current.confirm.mutateAsync({ id: "x", actualReceiptDate: "2026-09-01", cardCount: 1 }),
    () => result.current.printed.mutateAsync(["x"]),
    () => result.current.many.mutateAsync({ ids: ["x"] }),
  ];
  for (const operation of operations) {
    client.setQueryData(queryKeys.dashboardOverview("2026-09"), { value: { month: "2026-09" }, etag: '"one"' });
    await act(async () => {
      await operation();
    });
    expect(client.getQueryState(queryKeys.dashboardOverview("2026-09"))?.isInvalidated).toBe(true);
  }
  unmount();
  client.clear();
});
