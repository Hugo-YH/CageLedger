import { Modal, Typography } from "antd";

export function FundingBookConfirmationModal({
  pi,
  otherProjectFundingBooks,
  unknownFundingBookNos,
  pending,
  onCancel,
  onConfirm,
}: {
  pi: string;
  otherProjectFundingBooks: Array<{ value: string; label: string }>;
  unknownFundingBookNos: string[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      cancelText="返回修改"
      confirmLoading={pending}
      okText="确认继续"
      open={otherProjectFundingBooks.length > 0 || unknownFundingBookNos.length > 0}
      rootClassName="app-modal-root workflow-funding-book-confirm-modal"
      title="确认经费本信息"
      onCancel={onCancel}
      onOk={onConfirm}
    >
      {otherProjectFundingBooks.map((option) => (
        <Typography.Paragraph key={option.value}>
          {option.value} 为{option.label}的支撑经费。确认后将自动填写到报销单备注。
        </Typography.Paragraph>
      ))}
      {unknownFundingBookNos.length ? (
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          请确认{pi || "该项目负责人"}是否已新增支撑经费（经费本号：{unknownFundingBookNos.join("、")}）。
        </Typography.Paragraph>
      ) : null}
    </Modal>
  );
}
