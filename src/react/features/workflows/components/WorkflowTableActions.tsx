import { Button, Popconfirm, Typography } from "antd";
import type { BillingWorkflow } from "../../../api/workflows";
import type { WorkflowRevokeTarget } from "./WorkflowRevokeModal";
import { WorkflowRowActions, WorkflowViewButton } from "./WorkflowRowActions";

/** Stable three-slot presentation; state transitions still belong to the parent service hook. */
export function WorkflowTableActions({
  item,
  canLock,
  canWithdraw,
  canRegister,
  disabled,
  loading,
  onRegister,
  onDetail,
  onRevoke,
  onAdvance,
}: {
  item: BillingWorkflow;
  canLock: boolean;
  canWithdraw: boolean;
  canRegister: boolean;
  disabled: boolean;
  loading: boolean;
  onRegister: (item: BillingWorkflow) => void;
  onDetail: (item: BillingWorkflow) => void;
  onRevoke: (target: WorkflowRevokeTarget) => void;
  onAdvance: (toStatus: string, note: string) => Promise<void>;
}) {
  const sent = item.workflowStatus === "statement_sent";
  const archived = item.workflowStatus === "statement_archived";
  const locked = item.workflowStatus === "statement_locked";
  if (!sent && !archived && !locked) return <Typography.Text type="secondary">待发起</Typography.Text>;
  const unlockStatus = item.signedStatementReturned ? "statement_archived" : "statement_sent";
  const unlockLabel = unlockStatus === "statement_archived" ? "已归档" : "已发起";
  const action = locked ? "解锁" : "锁定";
  const description = locked
    ? `解锁后依据结算单交回状态回到${unlockLabel}，已补录信息会保留。`
    : sent
      ? "锁定后流程进入只读，单据交回状态保持当前记录；仅授权账号可解锁。"
      : "锁定后流程进入只读，仅授权账号可补录或解锁。";
  return (
    <WorkflowRowActions
      primary={
        sent && canRegister ? (
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
      lock={
        canLock ? (
          <Popconfirm
            destroyOnHidden
            title={`${action}该结算流程？`}
            description={description}
            okText={action}
            cancelText="取消"
            onConfirm={() => onAdvance(locked ? unlockStatus : "statement_locked", `${action}结算流程`)}
          >
            <Button
              aria-label={action}
              color="purple"
              variant={locked ? "filled" : "solid"}
              disabled={disabled}
              loading={loading}
            >
              {action}
            </Button>
          </Popconfirm>
        ) : undefined
      }
    />
  );
}
