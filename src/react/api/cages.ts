import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { CageSlot, Occupancy, OccupancyWriteResponse, PlacementWriteResponse, RoomWorkspace } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

async function refreshCageRoom(client: QueryClient, roomId: string, changedSlots: CageSlot[] = []) {
  const rackIds = new Set(changedSlots.map((slot) => slot.rackId));
  for (const [key, data] of client.getQueriesData<RoomWorkspace>({ queryKey: queryKeys.infrastructureRoomsRoot })) {
    if (key[3] === roomId) for (const rack of data?.racks || []) rackIds.add(rack.id);
  }
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.cageRoom(roomId) }),
    client.invalidateQueries({
      queryKey: queryKeys.infrastructureRoomsRoot,
      predicate: (query) => query.queryKey[3] === roomId,
    }),
    client.invalidateQueries({
      queryKey: queryKeys.infrastructureRackSlotsRoot,
      predicate: (query) => rackIds.has(String(query.queryKey[3])),
    }),
  ]);
}

export function useRefreshCageRoom(roomId: string) {
  const client = useQueryClient();
  return () => refreshCageRoom(client, roomId);
}

export function useSaveOccupancy(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ item, exists }: { item: Occupancy; exists: boolean; deferInvalidate?: boolean }) =>
      requestJson<OccupancyWriteResponse>(
        exists ? `/api/occupancies/${encodeURIComponent(item.id)}` : "/api/occupancies",
        {
          method: exists ? "PUT" : "POST",
          body: JSON.stringify({ item, expectedUpdatedAt: exists ? item.updatedAt : "" }),
        },
      ),
    onSuccess: (response, variables) =>
      variables.deferInvalidate ? undefined : refreshCageRoom(queryClient, roomId, response.affectedSlots),
  });
}

export function useReservePlacement(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, slotId }: { taskId: string; slotId: string }) =>
      requestJson<PlacementWriteResponse>(`/api/placement-tasks/${encodeURIComponent(taskId)}/reserve`, {
        method: "POST",
        body: JSON.stringify({ slotId }),
      }),
    onSuccess: (response) => refreshCageRoom(queryClient, roomId, response.affectedSlots),
  });
}

export function useMoveInPlacement(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, actualMoveInDate }: { taskId: string; actualMoveInDate: string }) =>
      requestJson<PlacementWriteResponse>(`/api/placement-tasks/${encodeURIComponent(taskId)}/move-in`, {
        method: "POST",
        body: JSON.stringify({ actualMoveInDate }),
      }),
    onSuccess: (response) => refreshCageRoom(queryClient, roomId, response.affectedSlots),
  });
}
