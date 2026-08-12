import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Typography } from "antd";
import { useRef, useState } from "react";

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
  const [manualCopy, setManualCopy] = useState(false);
  const bodyRef = useRef<HTMLPreElement>(null);

  async function copyAndConfirm() {
    // 内网 HTTP + 终端管控环境下，execCommand 可能返回成功但写入被拦截，
    // 程序无法确认剪贴板真实内容，因此弹窗不自动关闭：全选正文并交由用户
    // 粘贴验证，必要时按 Ctrl+C（Mac ⌘+C）手动复制后再确认发起流程。
    await copyTextToClipboard(`${email.subject}\n\n${email.body}`);
    setManualCopy(true);
    selectBody();
  }

  function selectBody() {
    const node = bodyRef.current;
    if (!node) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
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
            icon={manualCopy ? <CheckOutlined aria-hidden /> : <CopyOutlined aria-hidden />}
            loading={pending}
            type="primary"
            onClick={() => void (manualCopy ? onConfirm() : copyAndConfirm())}
          >
            {manualCopy ? "我已复制，确认发起流程" : "复制并确认"}
          </Button>
        </div>
      }
      width={720}
      onCancel={onCancel}
    >
      {manualCopy ? (
        <Alert
          className="settlement-notice-copy-hint"
          role="status"
          showIcon
          title="已全选邮件正文并尝试自动复制。请先在其他位置粘贴验证，若为空请按 Ctrl+C（Mac 为 ⌘+C）复制，然后点击右上角“我已复制，确认发起流程”"
          type="info"
        />
      ) : null}
      <pre ref={bodyRef} aria-label="邮件正文" className="settlement-notice-body">
        {email.body}
      </pre>
    </Modal>
  );
}
