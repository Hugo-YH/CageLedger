import { useQueryClient } from "@tanstack/react-query";

import type { SettlementCandidate } from "./contracts";
import { generateBillingStatement } from "./quantitySheets";
import { queryKeys } from "./queryKeys";
import { useSequentialBatch } from "./useSequentialBatch";
import { advanceWorkflow, deleteBillingWorkflow, invalidateWorkflowQueries } from "./workflows";

export interface SettlementBatchItem {
  candidate: SettlementCandidate;
  action: "start" | "withdraw";
  source: "quantity_sheet" | "cage_map";
}

export function useSettlementBatch() {
  const client = useQueryClient();
  return useSequentialBatch({
    execute: async ({ candidate, action, source }: SettlementBatchItem) => {
      if (action === "start") {
        return generateBillingStatement({
          month: candidate.month,
          pi: candidate.pi,
          sourceType: source,
          persist: true,
        });
      }
      if (!candidate.workflowId) throw new Error("缺少流程编号");
      if (candidate.workflowStatus === "statement_generated") return deleteBillingWorkflow(candidate.workflowId);
      return advanceWorkflow({
        workflowId: candidate.workflowId,
        toStatus: "statement_generated",
        note: "批量撤回，退回已生成",
      });
    },
    reconcile: () =>
      Promise.all([
        invalidateWorkflowQueries(client),
        client.invalidateQueries({ queryKey: queryKeys.reimbursementLedgerRoot }),
      ]),
  });
}
