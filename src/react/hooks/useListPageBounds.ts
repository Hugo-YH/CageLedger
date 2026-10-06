import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";

/** A smaller result invalidates cached pages before returning to the new final page. */
export function useListPageBounds(
  page: number,
  pages: number,
  ready: boolean,
  onPage: (page: number) => void,
  queryKey: QueryKey,
) {
  const client = useQueryClient();
  const clamp = useEffectEvent(() => {
    if (page <= pages) return;
    void client.invalidateQueries({ queryKey, refetchType: "none" });
    onPage(pages);
  });
  useEffect(() => {
    if (ready) clamp();
  }, [page, pages, ready]);
}
