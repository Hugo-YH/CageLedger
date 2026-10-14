import { useQueryClient } from "@tanstack/react-query";

import type { SettlementCandidate } from "./contracts";
import { generateBillingStatement } from "./quantitySheets";
import { useSequentialBatch } from "./useSequentialBatch";
import { advanceWorkflow, deleteBillingWorkflow, invalidateWorkflowQueries } from "./workflows";

export interface SettlementBatchItem {
  candidate: SettlementCandidate;
  action: "start" | "withdraw";
  source: "quantity_sheet" | "cage_map" | "pi_merged_technical_service";
  note?: string;
}

export function useSettlementBatch() {
  const client = useQueryClient();
  return useSequentialBatch({
    execute: async ({ candidate, action, source, note }: SettlementBatchItem) => {
      if (action === "start") {
        return generateBillingStatement({
          month: candidate.month,
          pi: candidate.pi,
          sourceType: source,
          persist: true,
        });
      }
      if (!candidate.workflowId) throw new Error("缺少流程编号");
      if (candidate.workflowStatus === "statement_generated") return deleteBillingWorkflow(candidate.workflowId, note);
      return advanceWorkflow({
        workflowId: candidate.workflowId,
        toStatus: "statement_generated",
        note,
      });
    },
    reconcile: () => invalidateWorkflowQueries(client),
  });
}
