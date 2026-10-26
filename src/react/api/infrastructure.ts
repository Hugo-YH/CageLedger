import { useQuery } from "@tanstack/react-query";
import type { CageRoom, CageSlot, InfrastructureStructure, RoomWorkspace } from "./contracts";
import { requestJson } from "./client";
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
export function useRoomWorkspace(roomId: string) {
  const actor = useActorScope();
  return useQuery({
    queryKey: queryKeys.infrastructureRoom(actor.scope, roomId),
    queryFn: ({ signal }) =>
      requestJson<RoomWorkspace>(`/api/infrastructure/rooms/${encodeURIComponent(roomId)}`, { signal }),
    enabled: actor.enabled && Boolean(roomId),
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
