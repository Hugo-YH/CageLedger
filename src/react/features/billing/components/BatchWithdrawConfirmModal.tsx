import { Alert, Button, Flex, Input, Modal, Typography } from "antd";
import { useState } from "react";

import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";

export function BatchWithdrawConfirmModal({
  count,
  open,
  pending,
  onConfirm,
  onCancel,
  title = "批量撤回结算流程",
}: {
  count: number;
  open: boolean;
  pending: boolean;
  onConfirm: (note: string) => Promise<void>;
  onCancel: () => void;
  title?: string;
}) {
  return (
    <Modal open={open} title={title} footer={null} destroyOnHidden onCancel={pending ? undefined : onCancel}>
      {open ? <WithdrawForm count={count} pending={pending} onConfirm={onConfirm} onCancel={onCancel} /> : null}
    </Modal>
  );
}

function WithdrawForm({
  count,
  pending,
  onConfirm,
  onCancel,
}: {
  count: number;
  pending: boolean;
  onConfirm: (note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const action = useAsyncFormAction("撤回失败，请重试");
  const busy = pending || action.pending;
  return (
    <>
      <Typography.Paragraph>
        将为已选的 {count}{" "}
        个结算流程执行撤回：“已生成”的撤销后将删除该结算流程，回到未发起（无流程）状态；“已发起”的撤回将退回已生成状态。系统会按顺序处理，每项保留独立的审计记录。
      </Typography.Paragraph>
      {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
      <label htmlFor="settlement-withdraw-reason">撤回原因</label>
      <Input.TextArea
        id="settlement-withdraw-reason"
        disabled={busy}
        maxLength={500}
        rows={3}
        value={note}
        placeholder="请填写撤回原因"
        onChange={(event) => setNote(event.target.value)}
      />
      <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
        <Button disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button
          danger
          type="primary"
          loading={busy}
          disabled={!note.trim() || !count}
          onClick={() => void action.run(() => onConfirm(note.trim()))}
        >
          撤回 {count} 个流程
        </Button>
      </Flex>
    </>
  );
}
