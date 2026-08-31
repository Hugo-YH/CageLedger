import { useQuery } from "@tanstack/react-query";

import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export type CageCardDetails = Record<string, string | number | null | undefined>;

export function usePublicCageCard(qrId: string) {
  return useQuery({
    queryKey: queryKeys.publicCageCard(qrId),
    queryFn: ({ signal }) =>
      requestJson<CageCardDetails>(`/api/public/cage-card/${encodeURIComponent(qrId)}`, { signal }),
    enabled: Boolean(qrId),
    retry: false,
  });
}
