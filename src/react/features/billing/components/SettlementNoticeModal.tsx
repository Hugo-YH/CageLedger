import { CopyOutlined } from "@ant-design/icons";
import { Button, Modal, Typography } from "antd";

import type { SettlementNoticeEmail } from "../../../../domain/settlementNotice";

export function SettlementNoticeModal({
  email,
  pending,
  onConfirm,
  onCancel,
}: {
  email: SettlementNoticeEmail;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  async function copyAndConfirm() {
    try {
      await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`);
    } catch {
      // 剪贴板不可用时仍允许发起结算流程。
    }
    onConfirm();
  }
  return (
    <Modal
      closable
      footer={null}
      open
      rootClassName="app-modal-root settlement-notice-modal"
      title={
        <div className="settlement-notice-head">
          <Typography.Text className="settlement-notice-subject" strong>
            {email.subject}
          </Typography.Text>
          <Button
            icon={<CopyOutlined aria-hidden />}
            loading={pending}
            type="primary"
            onClick={() => void copyAndConfirm()}
          >
            复制并确认
          </Button>
        </div>
      }
      width={720}
      onCancel={onCancel}
    >
      <pre className="settlement-notice-body">{email.body}</pre>
    </Modal>
  );
}
