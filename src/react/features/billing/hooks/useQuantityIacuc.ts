import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { IacucIndexItem } from "../../../../contracts/administration";
import { fetchIacucSearch, useIacucSearch } from "../../../api/iacuc";
import { queryKeys } from "../../../api/queryKeys";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

export function useQuantityIacuc(value: string, onMatch: (item: IacucIndexItem) => void) {
  const search = useIacucSearch(value, 20);
  const client = useQueryClient();
  const request = useLatestRequest();
  const lastFilled = useRef("");
  const [error, setError] = useState("");
  const options = useMemo(() => search.data?.items || [], [search.data?.items]);
  const normalized = value.trim().toUpperCase();
  const match = options.find((item) => item.iacuc.trim().toUpperCase() === normalized);

  const fill = useCallback(
    (item: IacucIndexItem) => {
      lastFilled.current = item.iacuc;
      setError("");
      onMatch(item);
    },
    [onMatch],
  );

  // Selection/paste and typed exact codes retain the existing automatic fill behavior.
  useEffect(() => {
    if (match && lastFilled.current !== match.iacuc) fill(match);
  }, [match, fill]);

  const reset = useCallback(() => {
    request.invalidate();
    lastFilled.current = "";
    setError("");
  }, [request]);

  async function apply(code: string) {
    const isCurrent = request.begin();
    const q = code.trim().toUpperCase();
    if (!q) return;
    const known = options.find((item) => item.iacuc.trim().toUpperCase() === q);
    if (known) {
      fill(known);
      return;
    }
    // Blur can precede the debounced search; share its key rather than start another request.
    try {
      const result = await client.ensureQueryData({
        queryKey: queryKeys.iacucSearch(q, 20),
        queryFn: ({ signal }) => fetchIacucSearch(q, 20, signal),
        staleTime: 5 * 60_000,
      });
      if (!isCurrent()) return;
      const exact = result.items.find((item) => item.iacuc.trim().toUpperCase() === q);
      if (exact) fill(exact);
    } catch (cause) {
      if (!isCurrent()) return;
      setError(cause instanceof Error ? `IACUC 信息匹配失败：${cause.message}` : "IACUC 信息匹配失败，请重试。");
    }
  }

  return { options, match, error, apply, reset };
}
