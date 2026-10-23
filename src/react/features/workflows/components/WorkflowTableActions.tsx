import { Button, Typography } from "antd";
import type { BillingWorkflow } from "../../../api/workflows";
import type { WorkflowRevokeTarget } from "./WorkflowRevokeModal";
import { WorkflowRowActions, WorkflowViewButton } from "./WorkflowRowActions";
import { WorkflowLockButton } from "./WorkflowLockControls";

/** Stable three-slot presentation; state transitions still belong to the parent service hook. */
export function WorkflowTableActions({
  item,
  canLock,
  canWithdraw,
  onRegister,
  onDetail,
  onRevoke,
}: {
  item: BillingWorkflow;
  canLock: boolean;
  canWithdraw: boolean;
  onRegister: (item: BillingWorkflow) => void;
  onDetail: (item: BillingWorkflow) => void;
  onRevoke: (target: WorkflowRevokeTarget) => void;
}) {
  const sent = item.workflowStatus === "statement_sent";
  const archived = item.workflowStatus === "statement_archived";
  const locked = item.workflowStatus === "statement_locked";
  if (!sent && !archived && !locked) return <Typography.Text type="secondary">待发起</Typography.Text>;
  return (
    <WorkflowRowActions
      primary={
        sent ? (
          <Button type="primary" onClick={() => onRegister(item)}>
            登记
          </Button>
        ) : (
          <WorkflowViewButton onClick={() => onDetail(item)} />
        )
      }
      revoke={
        !locked && canWithdraw ? (
          <Button
            danger
            onClick={() => onRevoke({ workflow: item, toStatus: sent ? "statement_generated" : "statement_sent" })}
          >
            撤回
          </Button>
        ) : undefined
      }
      lock={canLock ? <WorkflowLockButton item={item} /> : undefined}
    />
  );
}
