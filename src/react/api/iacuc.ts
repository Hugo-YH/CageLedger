import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IacucExpiryItem, IacucIndexItem } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useIacucExpiry() {
  return useQuery({
    queryKey: queryKeys.iacucExpiry,
    queryFn: ({ signal }) =>
      requestJson<{ items: IacucExpiryItem[]; count?: number }>("/api/iacuc-index/expiry", { signal }),
    staleTime: 5 * 60_000,
  });
}

export function fetchIacucSearch(query: string, limit = 20, signal?: AbortSignal) {
  const q = query.trim().toUpperCase();
  const search = new URLSearchParams({ q, limit: String(limit) });
  return requestJson<{ items: IacucIndexItem[]; count?: number }>(`/api/iacuc-index?${search.toString()}`, { signal });
}

export function useIacucSearch(query: string, limit = 20) {
  const normalized = query.trim().toUpperCase();
  const [debouncedQuery, setDebouncedQuery] = useState(normalized);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(normalized), 250);
    return () => window.clearTimeout(timer);
  }, [normalized]);
  const q = debouncedQuery;
  const result = useQuery({
    queryKey: queryKeys.iacucSearch(q, limit),
    queryFn: ({ signal }) => fetchIacucSearch(q, limit, signal),
    enabled: Boolean(q) && q === normalized,
    staleTime: 5 * 60_000,
  });
  // A previous code's suggestions must not remain selectable while the new search is debouncing.
  return { ...result, data: normalized && q === normalized ? result.data : undefined };
}
