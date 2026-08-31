import { isCancelledError, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1 || isCancelledError(error)) return false;
  if (error instanceof Error && error.name === "AbortError") return false;
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
