import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CageRoom,
  CageSlot,
  InfrastructureStructure,
  RackPlacement,
  RoomRackLayout,
  RoomWorkspace,
} from "./contracts";
import { ApiError, requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import { useSession } from "./session";

function useActorScope() {
  const session = useSession();
  const user = session.data?.user;
  return {
    enabled: Boolean(user),
    scope: { userId: user?.id || "", role: user?.role || "", roomIds: [...(user?.roomIds || [])].sort() },
  };
}
export function useRooms(enabled = true) {
  const actor = useActorScope();
  return useQuery({
    queryKey: queryKeys.roomDirectory(actor.scope),
    queryFn: ({ signal }) => requestJson<{ items: CageRoom[] }>("/api/rooms", { signal }),
    enabled: enabled && actor.enabled,
  });
}
export function useInfrastructureStructure() {
  const actor = useActorScope();
  return useQuery({
    queryKey: queryKeys.infrastructureStructure(actor.scope),
    queryFn: ({ signal }) => requestJson<InfrastructureStructure>("/api/infrastructure/structure", { signal }),
    enabled: actor.enabled,
  });
}
export function useRoomWorkspace(roomId: string, view?: "cages") {
  const actor = useActorScope();
  return useQuery({
    queryKey:
      view === "cages"
        ? queryKeys.infrastructureCageRoom(actor.scope, roomId)
        : queryKeys.infrastructureRoom(actor.scope, roomId),
    queryFn: ({ signal }) =>
      requestJson<RoomWorkspace>(
        `/api/infrastructure/rooms/${encodeURIComponent(roomId)}${view === "cages" ? "?view=cages" : ""}`,
        { signal },
      ),
    enabled: actor.enabled && Boolean(roomId),
  });
}
export function useSaveRoomRackLayout(roomId: string) {
  const { scope } = useActorScope();
  const client = useQueryClient();
  const key = queryKeys.infrastructureCageRoom(scope, roomId);
  return useMutation({
    mutationFn: ({ placements, expectedUpdatedAt }: { placements: RackPlacement[]; expectedUpdatedAt: string }) =>
      requestJson<RoomRackLayout>(`/api/infrastructure/rooms/${encodeURIComponent(roomId)}/rack-layout`, {
        method: "PUT",
        body: JSON.stringify({ placements, expectedUpdatedAt }),
      }),
    onSuccess: async (rackLayout) => {
      await client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<RoomWorkspace>(key, (room) => (room ? { ...room, rackLayout } : room));
      await client.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409)
        await client.invalidateQueries({ queryKey: key, exact: true });
    },
  });
}
export function useRackSlots(rackId: string) {
  const actor = useActorScope();
  return useQuery({
    queryKey: queryKeys.infrastructureRackSlots(actor.scope, rackId),
    queryFn: ({ signal }) =>
      requestJson<{ items: CageSlot[] }>(`/api/infrastructure/racks/${encodeURIComponent(rackId)}/slots`, { signal }),
    enabled: actor.enabled && Boolean(rackId),
  });
}
