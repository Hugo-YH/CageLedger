import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PagedResponse } from "../../contracts/common";
import type {
  DataQualityDetail,
  DataQualityIssues,
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

export function useDataQualityIssues(scanId: string, params: DataQualityParams) {
  return useQuery({
    queryKey: queryKeys.dataQualityIssues(scanId, params),
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({
        limit: String(params.limit),
        offset: String(params.offset),
        columnFilters: JSON.stringify(params.columnFilters),
      });
      if (params.sortKey) search.set("sortKey", params.sortKey);
      if (params.sortDir) search.set("sortDir", params.sortDir);
      return requestJson<DataQualityIssues>(`/api/data-quality/scans/${encodeURIComponent(scanId)}/issues?${search}`, {
        signal,
      });
    },
    enabled: Boolean(scanId),
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
