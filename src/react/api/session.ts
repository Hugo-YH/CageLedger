import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SessionResponse } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";
import { clearDiagnostics } from "../diagnostics/collector";

export function useSession(enabled = true) {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: async ({ signal }) => {
      const session = await requestJson<SessionResponse>("/api/auth/me?include=features", { signal });
      const previous = client.getQueryData<SessionResponse>(queryKeys.session);
      if (previous?.user?.id && previous.user.id !== session.user?.id) {
        client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      }
      return session;
    },
    retry: false,
    enabled,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      requestJson<SessionResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ ...credentials, includeFeatures: true }),
      }),
    onSuccess: async (session) => {
      await client.cancelQueries({ queryKey: queryKeys.session });
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      clearDiagnostics();
      client.setQueryData(queryKeys.session, session);
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      clearDiagnostics();
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      client.setQueryData<SessionResponse>(queryKeys.session, { user: null });
    },
  });
}
