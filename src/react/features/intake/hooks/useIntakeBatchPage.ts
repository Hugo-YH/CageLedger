import { useEffect, useMemo, useState } from "react";
import type { IntakeListParams } from "../../../api/contracts";
import { useIntakeBatches } from "../../../api/intake";

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
    blocked: query.isFetching || query.isError || query.isPlaceholderData,
    setPage,
    onPageSize: (value: number) => {
      setPageSize(value);
      setPage(1);
    },
    onSort: (key: string) => {
      setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
      setPage(1);
    },
    onFilter: (key: string, values: string[]) => {
      setFilters((current) => ({ ...current, [key]: values }));
      setPage(1);
    },
  };
}
