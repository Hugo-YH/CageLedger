import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Occupancy, RoomWorkspace } from "./contracts";
import { useMoveInPlacement, useRefreshCageRoom, useReservePlacement, useSaveOccupancy } from "./cages";
import { useRoomWorkspace } from "./infrastructure";
import { queryKeys } from "./queryKeys";

const scope = { userId: "actor", role: "admin", roomIds: [] };
const item: Occupancy = {
  id: "occupancy",
  slotId: "slot",
  cageCode: "A1",
  status: "active",
  iacuc: "IACUC",
  project: "项目",
  pi: "PI",
  owner: "负责人",
  startDate: "2026-11-01",
  endDate: "",
  notes: "",
  updatedAt: "2026-11-07T00:00:01.123456+00:00",
};
const workspace: RoomWorkspace = {
  rooms: [],
  racks: [{ id: "rack", roomId: "target", name: "笼架", index: 1, rows: 1, cols: 1 }],
  slots: [],
  occupancies: [item],
  placementTasks: [],
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.session, { user: { id: scope.userId, role: scope.role, roomIds: [] } });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    Promise.resolve(
      Response.json(
        String(input).includes("/api/infrastructure/")
          ? workspace
          : {
              item: { ...item, updatedAt: "server-new" },
              affectedSlots: [{ id: "slot", rackId: "rack", row: 1, col: 1, status: "active" }],
            },
      ),
    ),
  );
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, fetch, wrapper };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("sends exact server versions and defers every batch refresh until the explicit final reconciliation", async () => {
  const { client, fetch, wrapper } = setup();
  client.setQueryData(queryKeys.infrastructureRoom(scope, "target"), workspace);
  client.setQueryData(queryKeys.cageRoom("target"), { cached: true });
  client.setQueryData(queryKeys.roomDirectory(scope), { items: [] });
  client.setQueryData(queryKeys.infrastructureRackSlots(scope, "rack"), { items: [] });
  client.setQueryData(queryKeys.infrastructureRackSlots(scope, "unrelated-rack"), { items: [] });
  const hook = renderHook(
    () => ({
      target: useRoomWorkspace("target", "cages"),
      other: useRoomWorkspace("other", "cages"),
      save: useSaveOccupancy("target"),
      refresh: useRefreshCageRoom("target"),
    }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.target.isSuccess && hook.result.current.other.isSuccess).toBe(true));
  fetch.mockClear();
  await act(async () => {
    await hook.result.current.save.mutateAsync({ item, exists: true, deferInvalidate: true });
    await hook.result.current.save.mutateAsync({
      item: { ...item, id: "second" },
      exists: true,
      deferInvalidate: true,
    });
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, init] of fetch.mock.calls) {
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toMatchObject({ expectedUpdatedAt: item.updatedAt });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("deferInvalidate");
  }
  await act(() => hook.result.current.refresh());
  expect(fetch.mock.calls.map(([path]) => path).filter((path) => String(path).includes("/infrastructure/"))).toEqual([
    "/api/infrastructure/rooms/target?view=cages",
  ]);
  expect(client.getQueryState(queryKeys.infrastructureRoom(scope, "target"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.cageRoom("target"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.infrastructureRackSlots(scope, "rack"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.infrastructureRackSlots(scope, "unrelated-rack"))?.isInvalidated).toBe(false);
  expect(client.getQueryState(queryKeys.roomDirectory(scope))?.isInvalidated).toBe(false);
  expect(client.getQueryState(queryKeys.infrastructureCageRoom(scope, "other"))?.isInvalidated).toBe(false);
  hook.unmount();
  client.clear();
});

it.each(["save", "reserve", "move"] as const)(
  "%s refreshes the changed room without refetching another active room",
  async (operation) => {
    const { client, fetch, wrapper } = setup();
    const hook = renderHook(
      () => ({
        target: useRoomWorkspace("target", "cages"),
        other: useRoomWorkspace("other", "cages"),
        save: useSaveOccupancy("target"),
        reserve: useReservePlacement("target"),
        move: useMoveInPlacement("target"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.target.isSuccess && hook.result.current.other.isSuccess).toBe(true));
    fetch.mockClear();
    await act(async () => {
      if (operation === "save") await hook.result.current.save.mutateAsync({ item, exists: true });
      else if (operation === "reserve")
        await hook.result.current.reserve.mutateAsync({ taskId: "task", slotId: "slot" });
      else await hook.result.current.move.mutateAsync({ taskId: "task", actualMoveInDate: "2026-11-07" });
    });
    expect(fetch.mock.calls.filter(([, init]) => (init?.method || "GET") === "GET").map(([path]) => path)).toEqual([
      "/api/infrastructure/rooms/target?view=cages",
    ]);
    hook.unmount();
    client.clear();
  },
);

it("finishes an old room write after a room switch without refetching the new selection", async () => {
  const { client, fetch, wrapper } = setup();
  const hook = renderHook(
    ({ roomId }) => ({ room: useRoomWorkspace(roomId, "cages"), saveOld: useSaveOccupancy("target") }),
    { wrapper, initialProps: { roomId: "target" } },
  );
  await waitFor(() => expect(hook.result.current.room.isSuccess).toBe(true));
  hook.rerender({ roomId: "other" });
  await waitFor(() => expect(hook.result.current.room.isSuccess).toBe(true));
  fetch.mockClear();
  await act(() => hook.result.current.saveOld.mutateAsync({ item, exists: true }));
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]?.method).toBe("PUT");
  expect(client.getQueryState(queryKeys.infrastructureCageRoom(scope, "target"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(queryKeys.infrastructureCageRoom(scope, "other"))?.isInvalidated).toBe(false);
  hook.unmount();
  client.clear();
});
