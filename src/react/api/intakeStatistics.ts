import { useQuery } from "@tanstack/react-query";

import type { IntakeStatisticsPrincipal } from "../../contracts/intake";
import { resolveStatisticsPrincipal } from "../../domain/intakeStatistics";
import { fetchIacucSearch } from "./iacuc";
import { queryKeys } from "./queryKeys";

export async function fetchIntakeStatisticsPrincipals(codes: string[], signal?: AbortSignal) {
  const entries: [string, IntakeStatisticsPrincipal][] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, codes.length) }, async () => {
      while (next < codes.length) {
        signal?.throwIfAborted();
        const code = codes[next++];
        try {
          const response = await fetchIacucSearch(code, 80, signal);
          entries.push([code, resolveStatisticsPrincipal(code, response)]);
        } catch (error) {
          if (signal?.aborted) throw error;
          entries.push([code, { pi: "", issue: "项目汇总表查询失败，请重新查询" }]);
        }
      }
    }),
  );
  return Object.fromEntries(entries);
}

export function useIntakeStatisticsPrincipals(codes: string[]) {
  return useQuery({
    queryKey: queryKeys.intakeStatisticsPrincipals(codes),
    queryFn: ({ signal }) => fetchIntakeStatisticsPrincipals(codes, signal),
    enabled: codes.length > 0,
    staleTime: 0,
  });
}
