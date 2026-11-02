import { CopyOutlined } from "@ant-design/icons";
import { Alert, Button, Typography } from "antd";
import { Modal } from "../../../components/ui/Modal";

import type { SettlementNoticeEmail } from "../../../../domain/settlementNotice";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

export function SettlementNoticeModal({
  email,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  email: SettlementNoticeEmail;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const feedback = useOperationFeedback();
  const confirmation = useLatestRequest();
  async function copyAndConfirm() {
    const isCurrent = confirmation.begin();
    const copied = await copyTextToClipboard(`${email.subject}\n\n${email.body}`);
    if (!isCurrent()) return;
    if (!copied) feedback.message.error("未能自动复制邮件，请手动选择正文复制");
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
      {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
      <pre aria-label="邮件正文" className="settlement-notice-body">
        {email.body}
      </pre>
    </Modal>
  );
}
