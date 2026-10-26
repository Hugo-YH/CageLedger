import { Typography } from "antd";
import { Modal } from "../../../components/ui/Modal";

export function BatchStartConfirmModal({
  count,
  open,
  pending,
  disabled = false,
  onConfirm,
  onCancel,
}: {
  count: number;
  open: boolean;
  pending: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      cancelButtonProps={{ disabled: pending }}
      cancelText="取消"
      confirmLoading={pending}
      okButtonProps={{ disabled }}
      okText={`发起 ${count} 个流程`}
      open={open}
      title="批量发起结算流程"
      onCancel={onCancel}
      onOk={onConfirm}
    >
      <Typography.Paragraph>
        将为已选的 {count}{" "}
        个项目负责人结算项创建并发起结算流程（进入“已发起”状态）。系统会按顺序处理，每项保留独立的结算版本和审计记录。
      </Typography.Paragraph>
    </Modal>
  );
}
