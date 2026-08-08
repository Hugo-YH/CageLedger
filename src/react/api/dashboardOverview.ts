import { useQuery } from "@tanstack/react-query";

import { requestJson } from "./client";
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
};

export type DashboardOverviewResponse = {
  month: string;
  availableMonths: string[];
  intake: IntakeOverview;
  rooms: RoomOverview[];
  pi: PiOverview[];
};

export function useDashboardOverview(month?: string) {
  return useQuery({
    queryKey: queryKeys.dashboardOverview(month),
    queryFn: () =>
      requestJson<DashboardOverviewResponse>(
        `/api/dashboard/overview${month ? `?month=${encodeURIComponent(month)}` : ""}`,
      ),
  });
}
