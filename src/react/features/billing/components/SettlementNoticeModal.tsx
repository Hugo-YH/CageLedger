import { CopyOutlined } from "@ant-design/icons";
import { Button, Modal, Typography } from "antd";

import type { SettlementNoticeEmail } from "../../../../domain/settlementNotice";
import { copyTextToClipboard } from "../../../utils/clipboard";

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
    await copyTextToClipboard(`${email.subject}\n\n${email.body}`);
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
      <pre aria-label="邮件正文" className="settlement-notice-body">
        {email.body}
      </pre>
    </Modal>
  );
}
