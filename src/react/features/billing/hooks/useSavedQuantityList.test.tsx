import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceMemoryProvider } from "../../../state/WorkspaceMemoryProvider";
import { useSavedQuantityList } from "./useSavedQuantityList";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WorkspaceMemoryProvider>{children}</WorkspaceMemoryProvider>
      </QueryClientProvider>
    );
  }
  return { client, wrapper: Wrapper };
}
const response = (total: number, id: string) => new Response(JSON.stringify({ items: [{ id }], page: { total } }));

it("retains cache-owned rows after a failed page and unlocks only after recovery", async () => {
  const { client, wrapper } = setup();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(30, "first"));
  const { result, unmount } = renderHook(useSavedQuantityList, { wrapper });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  const original = result.current.data;
  fetch.mockResolvedValueOnce(new Response('{"error":"page unavailable"}', { status: 503 }));
  act(() => result.current.setPage(2));
  await waitFor(() => expect(result.current.list.isError).toBe(true));
  expect(result.current.data).toBe(original);
  expect(result.current.page).toBe(2);
  expect(result.current.blocked).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2); // Disabled observer never fetches.
  fetch.mockResolvedValueOnce(response(30, "second"));
  await act(async () => {
    await result.current.list.refetch({ cancelRefetch: false });
  });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  expect(result.current.data?.items[0].id).toBe("second");
  unmount();
  client.clear();
});

it("corrects an out-of-range restored page only after a successful fresh result", async () => {
  const { client, wrapper } = setup();
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(30, "first"));
  const { result, unmount } = renderHook(useSavedQuantityList, { wrapper });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  fetch.mockResolvedValueOnce(new Response('{"error":"offline"}', { status: 503 }));
  act(() => result.current.setPage(3));
  await waitFor(() => expect(result.current.list.isError).toBe(true));
  expect(result.current.page).toBe(3); // A failure cannot be interpreted as total=0.
  fetch.mockResolvedValueOnce(response(3, "")).mockResolvedValueOnce(response(3, "corrected"));
  await act(async () => {
    await result.current.list.refetch();
  });
  await waitFor(() => expect(result.current.page).toBe(1));
  await waitFor(() => expect(result.current.data?.items[0].id).toBe("corrected"));
  unmount();
  client.clear();
});

it("resets all list preferences when the account provider changes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(response(80, "sheet")));
  let actor = "one";
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WorkspaceMemoryProvider key={actor}>{children}</WorkspaceMemoryProvider>
      </QueryClientProvider>
    );
  }
  const { result, rerender, unmount } = renderHook(useSavedQuantityList, { wrapper: Wrapper });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  act(() => {
    result.current.setPage(2);
    result.current.setPageSize(20);
    result.current.setFilters({ month: ["2026-09"] });
    result.current.setSort({ key: "iacuc", dir: "asc" });
  });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  expect(result.current.page).toBe(2);
  expect(result.current.params).toMatchObject({
    limit: 20,
    offset: 20,
    sortKey: "iacuc",
    columnFilters: { month: ["2026-09"] },
  });
  actor = "two";
  rerender();
  await waitFor(() => expect(result.current.page).toBe(1));
  expect(result.current.filters).toEqual({});
  expect(result.current.pageSize).toBe(10);
  unmount();
  client.clear();
});
