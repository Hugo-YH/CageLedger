import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PagedResponse } from "../../contracts/common";
import type {
  DataQualityDetail,
  DataQualityIssues,
  DataQualityLatestIssues,
  DataQualityParams,
  DataQualityScan,
} from "../../contracts/dataQuality";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useDataQualityScans() {
  return useInfiniteQuery({
    queryKey: queryKeys.dataQualityScans,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      requestJson<PagedResponse<DataQualityScan>>(`/api/data-quality/scans?limit=20&offset=${pageParam}`, { signal }),
    getNextPageParam: (last) => (last.page.hasMore ? last.page.offset + last.page.limit : undefined),
  });
}

function issueSearch(params: DataQualityParams) {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    columnFilters: JSON.stringify(params.columnFilters),
  });
  if (params.sortKey) search.set("sortKey", params.sortKey);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  return search;
}

export function useDataQualityLatestIssues(params: DataQualityParams, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.dataQualityLatestIssues(params),
    queryFn: ({ signal }) =>
      requestJson<DataQualityLatestIssues>(`/api/data-quality/latest/issues?${issueSearch(params)}`, { signal }),
    enabled,
  });
}

export function useDataQualityIssues(scanId: string, params: DataQualityParams) {
  return useQuery({
    queryKey: queryKeys.dataQualityIssues(scanId, params),
    queryFn: ({ signal }) =>
      requestJson<DataQualityIssues>(
        `/api/data-quality/scans/${encodeURIComponent(scanId)}/issues?${issueSearch(params)}`,
        { signal },
      ),
    enabled: Boolean(scanId),
    staleTime: 30_000,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === scanId ? previous : undefined),
  });
}

export function useDataQualityIssue(scanId: string, issueId: string) {
  return useQuery({
    queryKey: queryKeys.dataQualityIssue(scanId, issueId),
    queryFn: ({ signal }) =>
      requestJson<DataQualityDetail>(
        `/api/data-quality/scans/${encodeURIComponent(scanId)}/issues/${encodeURIComponent(issueId)}`,
        { signal },
      ),
    enabled: Boolean(scanId && issueId),
  });
}
