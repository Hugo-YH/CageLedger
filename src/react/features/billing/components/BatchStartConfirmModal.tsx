import { Modal, Typography } from "antd";

export function BatchStartConfirmModal({
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
      okText={`发起 ${count} 个流程`}
      open={open}
      title="批量发起结算流程"
      onCancel={onCancel}
      onOk={onConfirm}
    >
      <Typography.Paragraph>
        将为已选的 {count} 个项目负责人结算项创建结算流程。系统会按顺序处理，每项保留独立的结算版本和审计记录。
      </Typography.Paragraph>
    </Modal>
  );
}
