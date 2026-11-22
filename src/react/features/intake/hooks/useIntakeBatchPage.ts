import { useEffect, useMemo, useState } from "react";
import type { IntakeListParams } from "../../../api/contracts";
import { useIntakeBatches } from "../../../api/intake";
import { queryKeys } from "../../../api/queryKeys";
import { useListPageBounds } from "../../../hooks/useListPageBounds";

export function useIntakeBatchPage(mode: "entry" | "batches") {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // Keep an unset initial key: the server puts undetermined dates first.
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const params = useMemo<IntakeListParams>(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      status: "pending",
      sortKey: sort.key,
      sortDir: sort.dir,
      columnFilters: filters,
    }),
    [pageSize, page, sort.key, sort.dir, filters],
  );
  const query = useIntakeBatches(params, mode === "batches");
  const [displayedParams, setDisplayedParams] = useState(params);
  const displayed = useIntakeBatches(displayedParams, false);
  useEffect(() => {
    if (query.isSuccess && !query.isPlaceholderData) setDisplayedParams(params);
  }, [query.isSuccess, query.isPlaceholderData, params]);
  const data = query.data ?? displayed.data;
  const pages = Math.max(1, Math.ceil((query.data?.page.total ?? 0) / pageSize));
  const blocked = query.isFetching || query.isError || query.isPlaceholderData;
  useListPageBounds(page, pages, mode === "batches" && query.isSuccess && !blocked, setPage, queryKeys.intakeRoot);
  const scope = JSON.stringify([
    mode,
    Object.entries(filters)
      .filter(([, values]) => values.length)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, [...values].sort()]),
  ]);
  return {
    page,
    pageSize,
    params,
    filters,
    query,
    data,
    scope,
    blocked,
    setPage,
    onPageSize: (value: number) => {
      setPageSize(value);
      setPage(1);
    },
    onSort: (key: string) => {
      setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
      setPage(1);
    },
    clearFilters: () => {
      setFilters({});
      setPage(1);
    },
    onFilter: (key: string, values: string[]) => {
      setFilters((current) => ({ ...current, [key]: values }));
      setPage(1);
    },
  };
}
