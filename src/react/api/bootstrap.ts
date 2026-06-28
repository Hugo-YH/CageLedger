import { useQuery } from "@tanstack/react-query";

import type { BootstrapResponse } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export type BootstrapScope = "summary" | "room" | "full";

export function bootstrapUrl(scope: BootstrapScope, roomId = "") {
  const params = new URLSearchParams({ scope });
  if (roomId) params.set("roomId", roomId);
  return `/api/bootstrap?${params.toString()}`;
}

export function useBootstrap(scope: BootstrapScope, roomId = "", enabled = true) {
  return useQuery({
    queryKey: queryKeys.bootstrap(scope, roomId),
    queryFn: () => requestJson<BootstrapResponse>(bootstrapUrl(scope, roomId)),
    enabled,
  });
}
