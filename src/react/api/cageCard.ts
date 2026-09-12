import { useQuery } from "@tanstack/react-query";
import type { PublicCageCardResponse } from "../../contracts/intake";

import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export type { CageCardDetails } from "../../contracts/intake";

export function usePublicCageCard(qrId: string) {
  return useQuery({
    queryKey: queryKeys.publicCageCard(qrId),
    queryFn: async ({ signal }) => {
      const response = await requestJson<PublicCageCardResponse>(`/api/public/cage-card/${encodeURIComponent(qrId)}`, {
        signal,
      });
      if (!response?.item || typeof response.item.qrId !== "string" || !response.item.qrId.trim()) {
        throw new Error("笼卡信息响应不完整，请刷新后重试");
      }
      return response.item;
    },
    enabled: Boolean(qrId),
    retry: false,
  });
}
