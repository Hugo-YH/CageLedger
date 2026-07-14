import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  AuditEvent,
  CageRack,
  CageRoom,
  CageSlot,
  IacucIndexStatus,
  ManagedUser,
  PagedResponse,
  PrincipalIdentity,
  SystemInfo,
  SystemUpdateStatus,
} from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => requestJson<{ users: ManagedUser[] }>("/api/users"),
    enabled,
  });
}

export function useSaveUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      user,
      expectedUpdatedAt,
    }: {
      id?: string;
      user: Partial<ManagedUser> & { password?: string };
      expectedUpdatedAt?: string;
    }) =>
      requestJson<{ user: ManagedUser }>(id ? `/api/users/${encodeURIComponent(id)}` : "/api/users", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({ ...user, expectedUpdatedAt: id ? expectedUpdatedAt : "" }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useDeleteUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requestJson<{ ok: true }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export interface InfrastructurePayload {
  rooms?: CageRoom[];
  roomUpdates?: CageRoom[];
  racks?: CageRack[];
  rackUpdates?: CageRack[];
  rackDeletes?: string[];
  slots?: CageSlot[];
  slotDeletes?: string[];
}

export function useSaveInfrastructure() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: InfrastructurePayload) =>
      requestJson<InfrastructurePayload>("/api/infrastructure", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["bootstrap"] });
      void client.invalidateQueries({ queryKey: queryKeys.infrastructure });
      void client.invalidateQueries({ queryKey: queryKeys.quantitySheetRooms });
    },
  });
}

export function useDeleteRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requestJson<{ ok: true }>(`/api/rooms/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["bootstrap"] });
      void client.invalidateQueries({ queryKey: queryKeys.quantitySheetRooms });
    },
  });
}

export function usePrincipalIdentities(enabled = true) {
  return useQuery({
    queryKey: queryKeys.principalIdentities,
    queryFn: () => requestJson<{ items: PrincipalIdentity[] }>("/api/principal-identities"),
    enabled,
  });
}
export function useSavePrincipalIdentity() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (item: PrincipalIdentity) =>
      requestJson<{ item: PrincipalIdentity }>(`/api/principal-identities/${encodeURIComponent(item.pi)}`, {
        method: "PUT",
        body: JSON.stringify({ ...item, expectedUpdatedAt: item.updatedAt }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.principalIdentities }),
  });
}
export function useIacucStatus() {
  return useQuery({
    queryKey: queryKeys.iacucStatus,
    queryFn: () => requestJson<IacucIndexStatus>("/api/iacuc-index/status"),
  });
}

export function useAuditEvents(limit: number, offset: number) {
  const params = { limit, offset };
  return useQuery({
    queryKey: queryKeys.auditEvents(params),
    queryFn: () => requestJson<PagedResponse<AuditEvent>>(`/api/audit-events?limit=${limit}&offset=${offset}`),
  });
}
export function useSystemInfo() {
  return useQuery({ queryKey: queryKeys.systemInfo, queryFn: () => requestJson<SystemInfo>("/api/system/info") });
}
export function useSystemUpdate(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.systemUpdate,
    queryFn: () => requestJson<SystemUpdateStatus>("/api/system/update-check"),
    enabled,
    retry: false,
  });
}

export async function uploadFile<T>(url: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(url, { method: "POST", body, credentials: "same-origin", cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `上传失败 (${response.status})`);
  return payload;
}
