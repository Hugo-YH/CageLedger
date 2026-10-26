import { useMemo } from "react";
import type { QuantitySheetListParams } from "../../../api/contracts";
import { useQuantitySheets } from "../../../api/quantitySheets";
import { queryKeys } from "../../../api/queryKeys";
import { useRetainedListData } from "../../../hooks/useRetainedListData";
import { useListPageBounds } from "../../../hooks/useListPageBounds";
import { useWorkspaceMemory, useWorkspaceScroll } from "../../../state/workspaceMemory";

/** Remember only list preferences. Business rows remain owned by the Query cache. */
export function useSavedQuantityList() {
  const [page, setPage] = useWorkspaceMemory("quantity-saved:page", 1);
  const [pageSize, setPageSize] = useWorkspaceMemory("quantity-saved:pageSize", 10);
  const [sort, setSort] = useWorkspaceMemory<{ key: string; dir: "asc" | "desc" }>("quantity-saved:sort", {
    key: "month",
    dir: "desc",
  });
  const [filters, setFilters] = useWorkspaceMemory<Record<string, string[]>>("quantity-saved:filters", {});
  const params = useMemo<QuantitySheetListParams>(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortKey: sort.key,
      sortDir: sort.dir,
      columnFilters: filters,
    }),
    [pageSize, page, sort.key, sort.dir, filters],
  );
  const list = useQuantitySheets(params);
  const retained = useRetainedListData(list, queryKeys.quantitySheets({ ...params }), "quantity-sheets");
  const data = retained.data;
  const pages = Math.max(1, Math.ceil((list.data?.page.total ?? 0) / pageSize));
  const ready = list.isSuccess && !list.isPlaceholderData && !list.isFetching;
  useListPageBounds(page, pages, ready, setPage, queryKeys.quantitySheetsRoot);
  useWorkspaceScroll("billing-quantity-saved", ready && page <= pages);
  return {
    page,
    setPage,
    pageSize,
    setPageSize,
    sort,
    setSort,
    filters,
    setFilters,
    params,
    list,
    data,
    loading: retained.loading,
    blocked: list.isFetching || retained.blocked,
  };
}
