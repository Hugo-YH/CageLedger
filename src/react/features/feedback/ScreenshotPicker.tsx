import { UploadOutlined } from "@ant-design/icons";
import { Button, Form, Upload } from "antd";
import type { UploadFile } from "antd/es/upload/interface";

export function ScreenshotPicker({
  canAdd,
  canRemove,
  files,
  formItem = true,
  onError,
  onFiles,
}: {
  canAdd: boolean;
  canRemove: boolean;
  files: UploadFile[];
  formItem?: boolean;
  onError: (message: string) => void;
  onFiles: (files: UploadFile[]) => void;
}) {
  const upload = (
    <Upload
      accept="image/png,image/jpeg,image/webp"
      beforeUpload={(file) => {
        if (!canAdd) return Upload.LIST_IGNORE;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
          onError("截图仅支持 PNG、JPEG、WebP，单张不得超过 10 MiB。");
          return Upload.LIST_IGNORE;
        }
        return false;
      }}
      fileList={files}
      maxCount={5}
      multiple
      showUploadList={{ showRemoveIcon: canRemove }}
      onChange={({ fileList }) => onFiles(fileList.slice(0, 5))}
    >
      <Button aria-label="选择截图" disabled={!canAdd} icon={<UploadOutlined aria-hidden="true" />}>
        选择截图
      </Button>
    </Upload>
  );
  return formItem ? (
    <Form.Item label="截图（可选，最多 5 张）">{upload}</Form.Item>
  ) : (
    <div className="feedback-supplement-files">{upload}</div>
  );
}
