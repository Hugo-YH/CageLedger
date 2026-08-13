import { Modal, Typography } from "antd";

export function BatchWithdrawConfirmModal({
  count,
  open,
  pending,
  onConfirm,
  onCancel,
}: {
  count: number;
  open: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      cancelButtonProps={{ disabled: pending }}
      cancelText="取消"
      confirmLoading={pending}
      okButtonProps={{ danger: true }}
      okText={`撤回 ${count} 个流程`}
      open={open}
      title="批量撤回结算流程"
      onCancel={onCancel}
      onOk={onConfirm}
    >
      <Typography.Paragraph>
        将为已选的 {count}{" "}
        个结算流程执行撤回：“已生成”的撤销后将删除该结算流程，回到未发起（无流程）状态；“已发起”的撤回将退回已生成状态。系统会按顺序处理，每项保留独立的审计记录。
      </Typography.Paragraph>
    </Modal>
  );
}
