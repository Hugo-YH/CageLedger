import { Alert, Button, Flex, Input, Space, Typography } from "antd";
import { SnippetsOutlined } from "@ant-design/icons";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from "react";

import { ActionIcon, Modal } from "../../components/ui";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { DialogActivityContext } from "../../state/dialogActivity";
import { certificatePastedFile, readCertificateClipboard } from "./certificateClipboard";
import { certificateErrorMessage, certificateUploadAccept } from "./certificateDraft";

export function ReceptionCertificateSourceModal({
  onFile,
  onClose,
}: {
  onFile: (file: File) => boolean | void;
  onClose: () => void;
}) {
  const active = useContext(DialogActivityContext);
  const input = useRef<HTMLInputElement>(null);
  const paste = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const busy = useRef(false);
  const fileHandler = useRef(onFile);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const { begin, invalidate } = useLatestRequest();
  useLayoutEffect(() => {
    fileHandler.current = onFile;
  }, [onFile]);
  useEffect(() => {
    if (active && error && !reading) paste.current?.focus();
  }, [active, error, reading]);

  function close() {
    invalidate();
    onClose();
  }

  function acceptFile(file: File) {
    if (fileHandler.current(file) === false) {
      busy.current = false;
      setError("接收列表尚未就绪或权限已变化，请刷新列表后重新选择原件。");
      return;
    }
    invalidate();
  }

  function selectFiles(files: ArrayLike<File>) {
    if (!active || busy.current) return;
    try {
      const file = certificatePastedFile(files);
      busy.current = true;
      acceptFile(file);
    } catch (reason) {
      busy.current = false;
      setError(certificateErrorMessage(reason, "无法读取合格证文件，请重新选择。"));
    }
  }

  async function readClipboard() {
    if (!active || busy.current) return;
    busy.current = true;
    const isCurrent = begin();
    setReading(true);
    setError("");
    try {
      const file = await readCertificateClipboard();
      if (isCurrent()) acceptFile(file);
    } catch (reason) {
      if (isCurrent()) {
        setError(certificateErrorMessage(reason, "无法读取剪贴板，请粘贴或上传文件。"));
      }
    } finally {
      busy.current = false;
      if (isCurrent()) setReading(false);
    }
  }

  return (
    <Modal open title="选择合格证来源" width={520} onCancel={close} footer={<Button onClick={close}>取消</Button>}>
      <Flex vertical gap={16}>
        <Typography.Text>读取剪贴板或上传一份 PDF、PNG、JPEG、WebP 原件，每份不超过 30 MiB。</Typography.Text>
        <Space wrap>
          <Button
            type="primary"
            icon={<SnippetsOutlined aria-hidden="true" />}
            loading={reading}
            onClick={() => void readClipboard()}
          >
            读取剪贴板
          </Button>
          <Button icon={<ActionIcon name="upload" />} disabled={reading} onClick={() => input.current?.click()}>
            上传文件
          </Button>
        </Space>
        <input
          ref={input}
          type="file"
          accept={certificateUploadAccept}
          aria-label="选择待识别合格证文件"
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length) selectFiles(files);
          }}
        />
        {error ? (
          <Alert
            showIcon
            type="error"
            title="未能选取合格证"
            description={error}
            action={
              <Button disabled={reading} onClick={() => void readClipboard()}>
                重试读取
              </Button>
            }
          />
        ) : null}
        <Flex vertical gap={8}>
          <Typography.Text>也可在下方粘贴合格证文件或图片</Typography.Text>
          <Input.TextArea
            ref={paste}
            readOnly
            disabled={reading}
            aria-label="粘贴合格证 PDF 或图片"
            placeholder="点击此处，按 ⌘V 或 Ctrl+V 粘贴文件或图片"
            autoSize={{ minRows: 3, maxRows: 3 }}
            onPaste={(event) => {
              event.preventDefault();
              selectFiles(event.clipboardData.files);
            }}
          />
          <Typography.Text type="secondary">
            浏览器可能只提供图片或不允许直接读取 PDF；可改用粘贴或上传文件。多份原件请逐份处理。
          </Typography.Text>
        </Flex>
      </Flex>
    </Modal>
  );
}
