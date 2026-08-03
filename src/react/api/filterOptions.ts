import { useQuery } from "@tanstack/react-query";

import { requestJson } from "./client";

export interface ColumnFilterOption {
  value: string;
  label: string;
  count: number;
}

/** Shared column filter-options hook backed by the generic /api/filter-options endpoint. */
export function useColumnFilterOptions(
  list: string,
  column: string,
  columnFilters: Record<string, string[]> | undefined,
  enabled: boolean,
) {
  const query = new URLSearchParams({ list, column });
  if (columnFilters && Object.keys(columnFilters).length) query.set("columnFilters", JSON.stringify(columnFilters));
  return useQuery({
    queryKey: ["filter-options", list, column, columnFilters || {}],
    queryFn: () => requestJson<{ items: ColumnFilterOption[] }>(`/api/filter-options?${query.toString()}`),
    enabled,
  });
}
