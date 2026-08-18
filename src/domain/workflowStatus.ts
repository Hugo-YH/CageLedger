export interface ReimbursementReturnWorkflow {
  reimbursementFormReturned?: boolean;
  receivedAmount?: number;
  totalAmount?: number;
}

export interface ReimbursementReturnStatus {
  label: string;
  color: string;
}

/** 报销单交回状态：已交回但未全额缴费时给出区分标签。 */
export function reimbursementReturnStatus(workflow: ReimbursementReturnWorkflow): ReimbursementReturnStatus {
  if (!workflow.reimbursementFormReturned) return { label: "报销单 未交回", color: "default" };
  const received = Number(workflow.receivedAmount || 0);
  const total = Number(workflow.totalAmount || 0);
  const fullyPaid = received >= total;
  return fullyPaid
    ? { label: "报销单 已交回", color: "blue" }
    : { label: "报销单 已交回（未全额缴费）", color: "orange" };
}
