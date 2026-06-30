import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Occupancy, OccupancyWriteResponse, PlacementWriteResponse } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useSaveOccupancy(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ item, exists }: { item: Occupancy; exists: boolean }) =>
      requestJson<OccupancyWriteResponse>(
        exists ? `/api/occupancies/${encodeURIComponent(item.id)}` : "/api/occupancies",
        { method: exists ? "PUT" : "POST", body: JSON.stringify({ item }) },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cageRoom(roomId) }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cageRoom(roomId) }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.cageRoom(roomId) }),
  });
}
