import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SessionResponse } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => requestJson<SessionResponse>("/api/auth/me"),
    retry: false,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      requestJson<SessionResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      }),
    onSuccess: (session) => client.setQueryData(queryKeys.session, session),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      client.setQueryData<SessionResponse>(queryKeys.session, { user: null });
    },
  });
}
