import { useQuery } from "@tanstack/react-query";
import type { IacucIndexItem } from "./contracts";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export function useIacucIndex() {
  return useQuery({
    queryKey: ["iacuc-index"],
    queryFn: () => requestJson<{ items: IacucIndexItem[]; count?: number }>("/api/iacuc-index"),
    staleTime: 5 * 60_000,
  });
}

export function fetchIacucSearch(query: string, limit = 20) {
  const q = query.trim().toUpperCase();
  const search = new URLSearchParams({ q, limit: String(limit) });
  return requestJson<{ items: IacucIndexItem[]; count?: number }>(`/api/iacuc-index?${search.toString()}`);
}

export function useIacucSearch(query: string, limit = 20) {
  const q = query.trim().toUpperCase();
  return useQuery({
    queryKey: queryKeys.iacucSearch(q, limit),
    queryFn: () => fetchIacucSearch(q, limit),
    enabled: Boolean(q),
    staleTime: 5 * 60_000,
  });
}
