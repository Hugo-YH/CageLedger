import { App, Button, Image, Input, Space, Tooltip, Upload } from "antd";
import type { UploadProps } from "antd";
import { DeleteOutlined, PlusOutlined, SwapOutlined } from "@ant-design/icons";

import { referenceImageDisplayUrl } from "../../../domain/inspectionCatalog";
import type { InspectionReferenceImageRow } from "../../../domain/inspectionCatalog";
import { useUploadInspectionCatalogImage } from "../../api/animalManagement";

const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

export function InspectionReferenceImages({
  value = [],
  onChange,
  disabled,
}: {
  value?: InspectionReferenceImageRow[];
  onChange?: (rows: InspectionReferenceImageRow[]) => void;
  disabled?: boolean;
}) {
  const upload = useUploadInspectionCatalogImage();
  const { message } = App.useApp();

  function uploadImage(file: File, onDone: (url: string) => void) {
    upload.mutate(file, {
      onSuccess: (result) => onDone(result.url),
      onError: (error) => {
        message.error(error instanceof Error ? error.message : "图片上传失败");
      },
    });
  }

  function updateRow(index: number, patch: Partial<InspectionReferenceImageRow>) {
    onChange?.(value.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function uploadProps(onDone: (url: string) => void): UploadProps {
    return {
      accept: IMAGE_ACCEPT,
      maxCount: 1,
      showUploadList: false,
      disabled: disabled || upload.isPending,
      beforeUpload: (file) => {
        uploadImage(file, onDone);
        return Upload.LIST_IGNORE;
      },
    };
  }

  return (
    <div className="inspection-reference-images">
      {value.length === 0 && <div className="inspection-reference-images-empty">暂无参考图</div>}
      {value.map((row, index) => {
        const displayUrl = referenceImageDisplayUrl(row.url);
        return (
          <div className="inspection-reference-image-row" key={`${row.url}-${index}`}>
            <Image
              className="inspection-reference-image-thumb"
              width={56}
              height={56}
              src={displayUrl}
              preview={{ src: displayUrl }}
              fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Crect width='100%25' height='100%25' fill='%23f0f2f5'/%3E%3C/svg%3E"
            />
            <Input
              className="inspection-reference-image-desc"
              placeholder="图片说明（可选）"
              value={row.desc || ""}
              disabled={disabled}
              onChange={(event) => updateRow(index, { desc: event.target.value })}
            />
            <Space.Compact>
              <Upload {...uploadProps((url) => updateRow(index, { url }))}>
                <Tooltip title="替换图片">
                  <Button icon={<SwapOutlined />} disabled={disabled || upload.isPending} />
                </Tooltip>
              </Upload>
              <Tooltip title="移除该参考图">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={disabled}
                  onClick={() => onChange?.(value.filter((_, rowIndex) => rowIndex !== index))}
                />
              </Tooltip>
            </Space.Compact>
          </div>
        );
      })}
      <Upload {...uploadProps((url) => onChange?.([...value, { url, desc: "" }]))}>
        <Button
          className="inspection-reference-image-add"
          icon={<PlusOutlined />}
          disabled={disabled || upload.isPending}
        >
          添加参考图
        </Button>
      </Upload>
    </div>
  );
}
