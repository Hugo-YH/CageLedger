import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SystemFeatureFlags, SystemFeatures, SystemFeaturesResponse } from "../../contracts/systemFeatures";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

const endpoint = "/api/system/features";

/** Shared feature configuration. The query exposes `item` directly for shell consumers. */
export function useSystemFeatures() {
  return useQuery({
    queryKey: queryKeys.systemFeatures,
    queryFn: async ({ signal }): Promise<SystemFeatures> => {
      const response = await requestJson<SystemFeaturesResponse>(endpoint, { signal });
      return response.item;
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useSaveSystemFeatures() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ enabled, expectedUpdatedAt }: { enabled: SystemFeatureFlags; expectedUpdatedAt: string | null }) =>
      requestJson<SystemFeaturesResponse>(endpoint, {
        method: "PUT",
        body: JSON.stringify({ enabled, expectedUpdatedAt }),
      }),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: queryKeys.systemFeatures });
    },
    onSuccess: async (response) => {
      await client.cancelQueries({ queryKey: queryKeys.systemFeatures });
      client.setQueryData(queryKeys.systemFeatures, response.item);
      void client.invalidateQueries({ queryKey: ["audit-events"] });
    },
  });
}
