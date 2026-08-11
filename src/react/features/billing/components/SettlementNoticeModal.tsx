import { CopyOutlined } from "@ant-design/icons";
import { App, Button, Modal, Typography } from "antd";

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
  const { message } = App.useApp();

  async function copyAndConfirm() {
    const copied = await copyTextToClipboard(`${email.subject}\n\n${email.body}`);
    if (copied) {
      message.success("邮件内容已复制");
    } else {
      message.warning("复制失败，请手动复制邮件正文；结算流程仍会继续发起。");
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
