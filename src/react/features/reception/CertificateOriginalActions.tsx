import { Button, Space } from "antd";
import { useRef } from "react";

import type { ReceptionCertificateAttachment } from "../../../contracts/reception";
import { ActionIcon } from "../../components/ui";
import { certificateMultipleFilesError, certificateUploadAccept } from "./certificateDraft";

export function CertificateOriginalActions({
  canWrite,
  disabled,
  uploading,
  recognizing,
  attachment,
  onUpload,
  onRecognize,
  onError,
}: {
  canWrite: boolean;
  disabled: boolean;
  uploading: boolean;
  recognizing: boolean;
  attachment?: ReceptionCertificateAttachment;
  onUpload: (file: File) => void;
  onRecognize: () => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Space wrap role="group" aria-label="合格证原件操作">
      {canWrite ? (
        <>
          <input
            ref={input}
            type="file"
            accept={certificateUploadAccept}
            aria-label="上传合格证文件"
            hidden
            disabled={disabled}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 1) {
                onError(certificateMultipleFilesError);
                return;
              }
              const file = files[0];
              if (file) onUpload(file);
            }}
          />
          <Button
            icon={<ActionIcon name="upload" />}
            disabled={disabled}
            loading={uploading}
            onClick={() => input.current?.click()}
          >
            上传
          </Button>
        </>
      ) : null}
      {attachment ? (
        <>
          <Button href={attachment.fileUrl} download={attachment.name} icon={<ActionIcon name="download" />}>
            下载
          </Button>
          {canWrite ? (
            <Button icon={<ActionIcon name="scan" />} loading={recognizing} disabled={disabled} onClick={onRecognize}>
              识别
            </Button>
          ) : null}
        </>
      ) : null}
    </Space>
  );
}
