import { useQuery, useQueryClient } from "@tanstack/react-query";

import { requestConditionalJson, type ConditionalJson } from "./client";
import { queryKeys } from "./queryKeys";

export type IntakeOverview = {
  month: string;
  batches: number;
  animals: number;
  trendUnit: "day" | "month";
  trend: Array<{ month?: string; day?: number; batches: number; animals: number }>;
  strains: Array<{ strain: string; animals: number }>;
  species: Array<{ species: string; animals: number }>;
};

export type RoomOverview = {
  roomName: string;
  species: string;
  cageDays: number;
  amount: number;
  unitPrice: number;
  firstDay: number;
  lastDay: number;
  days: number;
  trendUnit: "day" | "month";
  trend: Array<{ day: number; cages: number }>;
};

export type PiOverview = {
  pi: string;
  amount: number;
  iacucCount: number;
  amountState?: "ready" | "pending" | "error";
  amountError?: string;
};

export type DashboardOverviewResponse = {
  month: string;
  availableMonths: string[];
  intake: IntakeOverview;
  rooms: RoomOverview[];
  pi: PiOverview[];
  quantitySheetIacucCount?: number;
  feedingFeeTotal?: {
    amount: number | null;
    amountState: "ready" | "pending" | "error";
  };
};

export function useDashboardOverview(month?: string, enabled = true) {
  const client = useQueryClient();
  const key = queryKeys.dashboardOverview(month);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      requestConditionalJson<DashboardOverviewResponse>(
        `/api/dashboard/overview${month ? `?month=${encodeURIComponent(month)}` : ""}`,
        client.getQueryData<ConditionalJson<DashboardOverviewResponse>>(key),
        signal,
      ),
    select: selectOverview,
    enabled,
  });
}

function selectOverview(response: ConditionalJson<DashboardOverviewResponse>) {
  return response.value;
}
