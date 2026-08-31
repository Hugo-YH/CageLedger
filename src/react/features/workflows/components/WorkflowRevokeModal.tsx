import { Alert, Button, Flex, Input, Modal, Typography } from "antd";
import { useState } from "react";

import { type BillingWorkflow, useAdvanceWorkflow } from "../../../api/workflows";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";

export interface WorkflowRevokeTarget {
  workflow: BillingWorkflow;
  toStatus: string;
}

export function WorkflowRevokeModal({
  target,
  onCancel,
}: {
  target: WorkflowRevokeTarget | null;
  onCancel: () => void;
}) {
  return (
    <Modal
      destroyOnHidden
      footer={null}
      open={Boolean(target)}
      title="撤回结算流程"
      rootClassName="app-modal-root workflow-revoke-modal"
      onCancel={onCancel}
    >
      {target ? <WorkflowRevokeForm key={target.workflow.id} target={target} onCancel={onCancel} /> : null}
    </Modal>
  );
}

function WorkflowRevokeForm({ target, onCancel }: { target: WorkflowRevokeTarget; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const advance = useAdvanceWorkflow();
  const action = useAsyncFormAction("撤回失败，请重试");
  function submit() {
    if (!reason.trim()) return;
    void action.run(
      () =>
        advance.mutateAsync({
          workflowId: target.workflow.id,
          toStatus: target.toStatus,
          note: reason.trim(),
        }),
      onCancel,
    );
  }
  return (
    <>
      <Typography.Paragraph type="secondary">
        {target.toStatus === "statement_generated"
          ? "流程将退回已生成状态，可重新发起。"
          : "流程将退回等待交回登记状态，原归档信息保留。"}
      </Typography.Paragraph>
      {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
      <label htmlFor="workflow-revoke-reason">撤回原因</label>
      <Input.TextArea
        id="workflow-revoke-reason"
        disabled={action.pending}
        maxLength={500}
        placeholder="请填写撤回原因"
        rows={3}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button danger type="primary" loading={action.pending} disabled={!reason.trim()} onClick={submit}>
          确认撤回
        </Button>
      </Flex>
    </>
  );
}
