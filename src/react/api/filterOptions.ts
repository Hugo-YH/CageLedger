import { useQuery } from "@tanstack/react-query";

import { requestJson } from "./client";

export interface ColumnFilterOption {
  value: string;
  label: string;
  count: number;
}

/** A column's candidates depend on the other columns, never its own selection. */
export function otherColumnFilters(filters: Record<string, string[] | undefined> | undefined, column: string) {
  const result: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(filters || {})) {
    if (key !== column && values?.length) result[key] = values;
  }
  return result;
}

/** Shared column filter-options hook backed by the generic /api/filter-options endpoint. */
export function useColumnFilterOptions(
  list: string,
  column: string,
  columnFilters: Record<string, string[]> | undefined,
  enabled: boolean,
) {
  const filters = otherColumnFilters(columnFilters, column);
  const personFilterMode = ["intake-batches", "quantity-sheets", "settlement-candidates", "billing-workflows"].includes(
    list,
  )
    ? "individual"
    : "";
  const query = new URLSearchParams({ list, column });
  if (personFilterMode) query.set("personFilterMode", personFilterMode);
  if (Object.keys(filters).length) query.set("columnFilters", JSON.stringify(filters));
  return useQuery({
    queryKey: ["filter-options", list, column, filters, personFilterMode],
    queryFn: ({ signal }) =>
      requestJson<{ items: ColumnFilterOption[] }>(`/api/filter-options?${query.toString()}`, { signal }),
    enabled,
  });
}
