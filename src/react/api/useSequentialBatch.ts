import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

export interface BatchResult<T> {
  completed: T[];
  failures: Array<{ item: T; message: string }>;
}

/** One ordered write job at a time, with a single cache reconciliation at the end. */
export function useSequentialBatch<T>({
  execute,
  reconcile,
}: {
  execute: (item: T) => Promise<unknown>;
  reconcile: () => Promise<unknown>;
}) {
  const [completed, setCompleted] = useState(0);
  const pending = useRef<Promise<BatchResult<T>> | null>(null);
  const { mutateAsync, isPending, variables } = useMutation({
    mutationFn: async (items: T[]) => {
      const result: BatchResult<T> = { completed: [], failures: [] };
      for (const [index, item] of items.entries()) {
        try {
          await execute(item);
          result.completed.push(item);
        } catch (error) {
          result.failures.push({ item, message: error instanceof Error ? error.message : "操作失败" });
        }
        setCompleted(index + 1);
      }
      return result;
    },
    retry: false,
    // A lost response may follow a committed write, so reconcile even when all responses failed.
    onSettled: reconcile,
  });
  const run = useCallback(
    (items: T[]) => {
      if (pending.current) return pending.current;
      if (!items.length) return Promise.resolve<BatchResult<T>>({ completed: [], failures: [] });
      setCompleted(0);
      const completion = mutateAsync([...items]).finally(() => {
        pending.current = null;
      });
      pending.current = completion;
      return completion;
    },
    [mutateAsync],
  );
  return { run, isPending, completed, total: variables?.length || 0 };
}
