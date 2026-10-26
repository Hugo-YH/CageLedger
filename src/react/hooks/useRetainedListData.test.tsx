import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSession } from "../api/session";
import { queryKeys } from "../api/queryKeys";
import { useRetainedListData } from "./useRetainedListData";

type PageData = { items: string[]; page: number };
const key = (page: number, resource = "records") => ["retained-example", { page, resource }] as const;
const actor = { id: "one", role: "admin", roomIds: [] };
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
  client.setQueryData(queryKeys.session, { user: actor });
  const read = vi.fn((page: number, resource: string): Promise<PageData> =>
    Promise.resolve({ items: [`${resource}-${page}`], page }),
  );
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  function useModel() {
    const { data: session } = useSession(false);
    const [page, setPage] = useState(1);
    const [resource, setResource] = useState("records");
    const queryKey = key(page, resource);
    const query = useQuery({
      queryKey,
      queryFn: () => read(page, resource),
      enabled: Boolean(session?.user),
      placeholderData: (previous) => previous,
    });
    return { query, ...useRetainedListData(query, queryKey, resource), setPage, setResource };
  }
  return { client, read, wrapper, useModel };
}

it("pins cache-owned rows across a failed page, adds no requests, and recovers on retry", async () => {
  const { client, read, wrapper, useModel } = setup();
  const { result, unmount } = renderHook(useModel, { wrapper });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  const original = result.current.data;
  read.mockRejectedValueOnce(new Error("offline"));
  act(() => result.current.setPage(2));
  await waitFor(() => expect(result.current.query.isError).toBe(true));
  expect(result.current.data).toBe(original);
  expect(result.current.retained).toBe(true);
  expect(result.current.blocked).toBe(true);
  expect(client.getQueryData(key(1))).toBe(original);
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => {
    await result.current.query.refetch();
  });
  await waitFor(() => expect(result.current.data?.items).toEqual(["records-2"]));
  expect(result.current.blocked).toBe(false);
  unmount();
  client.clear();
});

it("never displays another method or scan scope as placeholder data", async () => {
  const { client, read, wrapper, useModel } = setup();
  const { result, unmount } = renderHook(useModel, { wrapper });
  await waitFor(() => expect(result.current.data?.items).toEqual(["records-1"]));
  read.mockRejectedValueOnce(new Error("new scope offline"));
  act(() => result.current.setResource("other-scan"));
  await waitFor(() => expect(result.current.query.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
  expect(result.current.blocked).toBe(true);
  unmount();
  client.clear();
});

it("retains the exact old query function when other observers invalidate it", async () => {
  const { client, read, wrapper, useModel } = setup();
  const { result, unmount } = renderHook(
    () => {
      const model = useModel();
      useQuery({ queryKey: key(1), queryFn: () => read(1, "records") });
      return model;
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.blocked).toBe(false));
  act(() => result.current.setPage(2));
  await waitFor(() => expect(result.current.data?.page).toBe(2));
  // Revisit a successful page then fail a new one so the pinned key differs.
  act(() => result.current.setPage(1));
  await waitFor(() => expect(result.current.data?.page).toBe(1));
  read.mockRejectedValueOnce(new Error("page unavailable"));
  act(() => result.current.setPage(3));
  await waitFor(() => expect(result.current.query.isError).toBe(true));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["retained-example"] });
  });
  expect(client.getQueryData<PageData>(key(1))?.page).toBe(1);
  expect(client.getQueryData<PageData>(key(3))?.page).toBe(3);
  unmount();
  client.clear();
});

it("does not keep a former account response after logout clears its queries", async () => {
  const { client, wrapper, useModel } = setup();
  const { result, unmount } = renderHook(useModel, { wrapper });
  await waitFor(() => expect(result.current.data?.page).toBe(1));
  act(() => {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
    client.setQueryData(queryKeys.session, { user: null });
  });
  await waitFor(() => expect(result.current.data).toBeUndefined());
  expect(result.current.blocked).toBe(true);
  unmount();
  client.clear();
});

it("clears cached pages on room permission changes before accepting new results", async () => {
  const { client, read, wrapper, useModel } = setup();
  client.setQueryData(key(2), { items: ["old-room-2"], page: 2 });
  const { result, unmount } = renderHook(useModel, { wrapper });
  await waitFor(() => expect(result.current.data?.page).toBe(1));
  let resolveRead!: (data: PageData) => void;
  read.mockImplementationOnce(() => new Promise<PageData>((resolve) => (resolveRead = resolve)));
  act(() => {
    client.setQueryData(queryKeys.session, { user: { ...actor, role: "room_admin", roomIds: ["room-b"] } });
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(result.current.data).toBeUndefined();
  expect(result.current.loading).toBe(true);
  expect(result.current.blocked).toBe(true);
  expect(client.getQueryData(key(2))).toBeUndefined();
  act(() => resolveRead({ items: ["room-b-1"], page: 1 }));
  await waitFor(() => expect(result.current.data?.items).toEqual(["room-b-1"]));
  expect(result.current.blocked).toBe(false);
  unmount();
  client.clear();
});

it("shows local loading while another hard scope is pending without additional session reads", async () => {
  const { client, read, wrapper, useModel } = setup();
  const fetch = vi.spyOn(globalThis, "fetch");
  const { result, unmount } = renderHook(useModel, { wrapper });
  await waitFor(() => expect(result.current.data?.page).toBe(1));
  read.mockImplementationOnce(() => new Promise<PageData>(() => {}));
  act(() => result.current.setResource("other-scan"));
  await waitFor(() => expect(result.current.query.isPlaceholderData).toBe(true));
  expect(result.current.data).toBeUndefined();
  expect(result.current.loading).toBe(true);
  expect(result.current.blocked).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  unmount();
  client.clear();
});
