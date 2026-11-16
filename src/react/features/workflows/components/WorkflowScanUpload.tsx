import { UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Flex, Typography, Upload, type UploadFile } from "antd";
import { useState } from "react";

import type { BillingWorkflowAttachment } from "../../../api/workflows";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

/** Keep a failed scan in memory so retry never requires choosing it again. */
export function WorkflowScanUpload({
  attachment,
  disabled,
  pending,
  onUpload,
}: {
  attachment: BillingWorkflowAttachment | null;
  disabled: boolean;
  pending: boolean;
  onUpload: (file: File) => Promise<BillingWorkflowAttachment | undefined>;
}) {
  const [selected, setSelected] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadFile["status"]>();
  const [validationError, setValidationError] = useState("");
  const request = useLatestRequest();
  async function upload(file: File) {
    if (disabled) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name) || !file.size || file.size > 30 * 1024 * 1024) {
      setValidationError("请选择非空的 PDF、JPEG 或 PNG 文件，单个附件不超过 30 MiB。");
      return;
    }
    const isCurrent = request.begin();
    setValidationError("");
    setSelected(file);
    setStatus("uploading");
    try {
      const uploaded = await onUpload(file);
      if (isCurrent()) setStatus(uploaded ? "done" : "error");
    } catch {
      if (isCurrent()) setStatus("error");
    }
  }
  const complete = status === "done" || !selected;
  const fileList: UploadFile[] =
    selected || attachment
      ? [
          {
            uid: attachment?.id || "selected-scan",
            name: selected?.name || attachment!.originalName,
            size: selected?.size || attachment?.sizeBytes,
            status: status || "done",
            url:
              complete && attachment
                ? `/api/billing-workflows/attachments/${encodeURIComponent(attachment.id)}`
                : undefined,
          },
        ]
      : [];
  return (
    <Flex vertical gap={4}>
      <Upload
        accept=".pdf,.jpg,.jpeg,.png"
        disabled={disabled}
        fileList={fileList}
        maxCount={1}
        showUploadList={{ showRemoveIcon: false, showPreviewIcon: true, showDownloadIcon: complete }}
        beforeUpload={() => false}
        onChange={({ file, fileList: next }) => {
          // beforeUpload=false emits a compatibility File; the controlled list
          // retains its original object, including the bytes needed for retry.
          const original = next.find((item) => item.uid === file.uid)?.originFileObj;
          if (original && file.status !== "removed") void upload(original);
        }}
      >
        <Button icon={<UploadOutlined aria-hidden />} disabled={disabled} loading={pending} size="small">
          上传扫描件
        </Button>
      </Upload>
      {pending ? <Typography.Text role="status">正在上传扫描件…</Typography.Text> : null}
      {status === "error" && selected ? (
        <Button disabled={disabled} size="small" onClick={() => void upload(selected)}>
          重试上传
        </Button>
      ) : null}
      {validationError ? <Alert role="alert" showIcon type="error" title={validationError} /> : null}
      <Typography.Text type="secondary">选填；支持 PDF、JPEG、PNG，单个附件不超过 30 MiB。</Typography.Text>
    </Flex>
  );
}
