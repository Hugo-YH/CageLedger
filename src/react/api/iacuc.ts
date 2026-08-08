import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IacucExpiryItem, IacucIndexItem } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useIacucExpiry() {
  return useQuery({
    queryKey: queryKeys.iacucExpiry,
    queryFn: () => requestJson<{ items: IacucExpiryItem[]; count?: number }>("/api/iacuc-index/expiry"),
    staleTime: 5 * 60_000,
  });
}

export function fetchIacucSearch(query: string, limit = 20) {
  const q = query.trim().toUpperCase();
  const search = new URLSearchParams({ q, limit: String(limit) });
  return requestJson<{ items: IacucIndexItem[]; count?: number }>(`/api/iacuc-index?${search.toString()}`);
}

export function useIacucSearch(query: string, limit = 20) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const q = debouncedQuery.trim().toUpperCase();
  return useQuery({
    queryKey: queryKeys.iacucSearch(q, limit),
    queryFn: () => fetchIacucSearch(q, limit),
    enabled: Boolean(q),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}
