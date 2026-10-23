import { useContext } from "react";
import { Button, Checkbox, Popconfirm, type CheckboxProps } from "antd";
import type { BillingWorkflow } from "../../../api/workflows";
import { WorkflowLockContext } from "./workflowLockContext";

function useWorkflowLock() {
  const controller = useContext(WorkflowLockContext);
  if (!controller) throw new Error("Workflow lock controls require WorkflowLockContext");
  return controller;
}

export function WorkflowLockCheckbox({ disabled, ...props }: CheckboxProps) {
  const { pending } = useWorkflowLock();
  return <Checkbox {...props} disabled={disabled || pending} />;
}

export function WorkflowLockButton({ item }: { item: BillingWorkflow }) {
  const { pending, activeId, onAdvance } = useWorkflowLock();
  const sent = item.workflowStatus === "statement_sent";
  const locked = item.workflowStatus === "statement_locked";
  const unlockStatus =
    item.unlockStatus ??
    (item.lockedFromStatus === "statement_archived" ||
    (item.lockedFromStatus !== "statement_sent" && item.signedStatementReturned)
      ? "statement_archived"
      : "statement_sent");
  const unlockLabel = unlockStatus === "statement_archived" ? "已登记" : "已发起";
  const action = locked ? "解锁" : "锁定";
  const description = locked
    ? `解锁后恢复未归档，流程回到${unlockLabel}，已补录信息会保留。`
    : sent
      ? "锁定后标记为已归档，流程进入只读，单据交回状态保持当前记录；仅授权账号可解锁。"
      : "锁定后标记为已归档，流程进入只读，仅授权账号可补录或解锁。";
  return (
    <Popconfirm
      destroyOnHidden
      title={`${action}该结算流程？`}
      description={description}
      okText={action}
      cancelText="取消"
      onConfirm={() =>
        onAdvance({
          workflowId: item.id,
          toStatus: locked ? unlockStatus : "statement_locked",
          note: `${action}结算流程`,
        })
      }
    >
      <Button
        aria-label={action}
        color="purple"
        variant={locked ? "filled" : "solid"}
        disabled={pending}
        loading={activeId === item.id}
      >
        {action}
      </Button>
    </Popconfirm>
  );
}
