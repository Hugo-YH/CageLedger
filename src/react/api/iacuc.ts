import { useQuery } from "@tanstack/react-query";
import type { IacucIndexItem } from "./contracts";
import { requestJson } from "./client";

export function useIacucIndex() {
  return useQuery({ queryKey: ["iacuc-index"], queryFn: () => requestJson<{ items: IacucIndexItem[]; count?: number }>("/api/iacuc-index"), staleTime: 5 * 60_000 });
}
