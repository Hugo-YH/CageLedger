import { useQuery } from "@tanstack/react-query";

import type { IntakeStatisticsPrincipal } from "../../contracts/intake";
import { resolveStatisticsPrincipal } from "../../domain/intakeStatistics";
import { requestJson } from "./client";
import { queryKeys } from "./queryKeys";

export async function fetchIntakeStatisticsPrincipals(codes: string[], signal?: AbortSignal) {
  const entries: [string, IntakeStatisticsPrincipal][] = [];
  const normalized = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  const batches = Array.from({ length: Math.ceil(normalized.length / 200) }, (_, index) =>
    normalized.slice(index * 200, (index + 1) * 200),
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, batches.length) }, async () => {
      while (next < batches.length) {
        signal?.throwIfAborted();
        const part = batches[next++];
        try {
          const response = await requestJson<{
            items: Array<{ iacuc: string; pi: string }>;
            counts: Record<string, number>;
            updatedAt?: string | null;
          }>("/api/iacuc-index/lookup", { method: "POST", signal, body: JSON.stringify({ codes: part }) });
          signal?.throwIfAborted();
          const byCode = new Map<string, Array<{ iacuc: string; pi: string }>>();
          for (const item of response.items) {
            const code = item.iacuc.trim().toUpperCase();
            const matches = byCode.get(code) || [];
            matches.push(item);
            byCode.set(code, matches);
          }
          for (const code of part) {
            const items = byCode.get(code) || [];
            const count = response.counts[code];
            if (!Number.isSafeInteger(count) || count < items.length)
              throw new Error("Incomplete project lookup counts");
            entries.push([code, resolveStatisticsPrincipal(code, { items, count })]);
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          entries.push(
            ...part.map((code): [string, IntakeStatisticsPrincipal] => [
              code,
              { pi: "", issue: "项目汇总表查询失败，请重新查询" },
            ]),
          );
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
