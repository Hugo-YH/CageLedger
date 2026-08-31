import { useQueryClient } from "@tanstack/react-query";

import { useSequentialBatch } from "./useSequentialBatch";
import { advanceWorkflow, invalidateWorkflowQueries } from "./workflows";

export function useBatchAdvanceWorkflow() {
  const client = useQueryClient();
  return useSequentialBatch({
    execute: advanceWorkflow,
    reconcile: () => invalidateWorkflowQueries(client),
  });
}
