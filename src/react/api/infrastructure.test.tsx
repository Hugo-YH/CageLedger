import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { useDeleteRoom, useSaveInfrastructure } from "./administration";
import { useRooms, useRoomWorkspace } from "./infrastructure";
import { queryKeys } from "./queryKeys";

const actor = (id: string, roomIds: string[]) => ({
  id,
  username: id,
  displayName: id,
  role: "room_admin" as const,
  roomIds,
  phone: "",
  active: true,
  updatedAt: "",
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shares one room request for two consumers and isolates different actor scopes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.session, { user: actor("one", ["r1"]) });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ items: [{ id: "r1", name: "8014" }] }));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result, unmount } = renderHook(() => ({ first: useRooms(), second: useRooms() }), { wrapper });
  await waitFor(() => expect(result.current.first.isSuccess && result.current.second.isSuccess).toBe(true));
  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockResolvedValueOnce(Response.json({ items: [{ id: "r2", name: "8020" }] }));
  act(() => {
    client.setQueryData(queryKeys.session, { user: actor("two", ["r2"]) });
  });
  await waitFor(() => expect(result.current.first.data?.items[0].id).toBe("r2"));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(queryKeys.roomDirectory({ userId: "one", role: "room_admin", roomIds: ["r1"] }))).toEqual({
    items: [{ id: "r1", name: "8014" }],
  });
  unmount();
  client.clear();
});

it.each(["save", "delete"])("invalidates shared and legacy infrastructure caches after %s", async (action) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result, unmount } = renderHook(() => ({ save: useSaveInfrastructure(), remove: useDeleteRoom() }), {
    wrapper,
  });
  await act(async () => {
    if (action === "save") await result.current.save.mutateAsync({ rooms: [{ id: "r1", name: "8014" }] });
    else await result.current.remove.mutateAsync("r1");
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.roomDirectoryRoot });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["bootstrap"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.infrastructure });
  unmount();
  client.clear();
});

it("keeps cage and full workspace responses in separate cancellable queries", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.session, { user: actor("one", ["r1"]) });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    Promise.resolve(
      Response.json({
        rooms: [],
        racks: [],
        slots: [],
        occupancies: String(input).endsWith("?view=cages") ? [] : [{ id: "historical", status: "ended" }],
        placementTasks: [],
      }),
    ),
  );
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const hook = renderHook(() => ({ full: useRoomWorkspace("r1"), cages: useRoomWorkspace("r1", "cages") }), {
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.full.isSuccess && hook.result.current.cages.isSuccess).toBe(true));
  expect(hook.result.current.full.data?.occupancies).toHaveLength(1);
  expect(hook.result.current.cages.data?.occupancies).toHaveLength(0);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(
    expect.arrayContaining(["/api/infrastructure/rooms/r1", "/api/infrastructure/rooms/r1?view=cages"]),
  );
  expect(fetch.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  hook.unmount();
  client.clear();
});
