import { Tag } from "antd";

import { reimbursementReturnStatus, type ReimbursementReturnWorkflow } from "../../domain/workflowStatus";
import { tagColors } from "../../theme/visual-system.mjs";

export function FeeTypeTag({ feeType }: { feeType?: "feeding" | "technical_service" }) {
  const technical = feeType === "technical_service";
  return (
    <Tag color={tagColors.feeType[technical ? "technical_service" : "feeding"]}>
      {technical ? "技术服务费" : "饲养费"}
    </Tag>
  );
}

export function ReimbursementReturnTag({ workflow }: { workflow: ReimbursementReturnWorkflow }) {
  // Keep the existing status calculation and labels; normalize only its display color.
  const status = reimbursementReturnStatus(workflow);
  return <Tag color={status.color === "blue" ? tagColors.document.reimbursement : status.color}>{status.label}</Tag>;
}
