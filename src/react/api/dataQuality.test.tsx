import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDataQualityIssue, useDataQualityIssues, useDataQualityScans } from "./dataQuality";

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it("does not display a previous archive's findings while the next archive is loading", async () => {
  let finish!: (value: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (String(input).includes("/old/"))
      return Promise.resolve(Response.json({ scan: { id: "old" }, items: [{ id: "old-issue" }] }));
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const { result, rerender } = renderHook(
    ({ scan }) => useDataQualityIssues(scan, { limit: 10, offset: 0, columnFilters: {} }),
    { wrapper, initialProps: { scan: "old" } },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  rerender({ scan: "new" });
  expect(result.current.data).toBeUndefined();
  await act(async () => {
    finish(Response.json({ scan: { id: "new" }, items: [{ id: "new-issue" }] }));
    await Promise.resolve();
  });
  await waitFor(() => expect(result.current.data?.scan.id).toBe("new"));
});

it("loads older archive pages using the server offset and only GET requests", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const offset = Number(new URL(String(input), "http://localhost").searchParams.get("offset"));
    return Promise.resolve(
      Response.json({
        items: [{ id: offset ? "older" : "latest" }],
        page: { offset, limit: 20, total: 21, hasMore: !offset },
      }),
    );
  });
  const { result } = renderHook(useDataQualityScans, { wrapper });
  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  await act(async () => {
    await result.current.fetchNextPage();
  });
  await waitFor(() => expect(result.current.data?.pages.map((page) => page.items[0].id)).toEqual(["latest", "older"]));
  expect(result.current.hasNextPage).toBe(false);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "/api/data-quality/scans?limit=20&offset=0",
    "/api/data-quality/scans?limit=20&offset=20",
  ]);
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("cancels a detail read when its viewer unmounts", async () => {
  let signal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => undefined);
  });
  const { unmount } = renderHook(() => useDataQualityIssue("archive", "issue"), { wrapper });
  await waitFor(() => expect(signal).toBeDefined());
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});
