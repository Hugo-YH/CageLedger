import { useState } from "react";
import { Button, Form, Image, Input, Modal, Select, Space, Upload } from "antd";
import type { UploadFile } from "antd";

import type { InspectionAnswer, InspectionCatalogNode } from "../../api/contracts";

export type ReferencePreview = {
  images: Array<{ url: string; desc?: string }>;
  initialIndex: number;
  title: string;
};

export function FindingCaptureDialog({
  node,
  answer,
  onClose,
  onConfirm,
  onReference,
}: {
  node: InspectionCatalogNode;
  answer?: InspectionAnswer;
  onClose: () => void;
  onConfirm: (result: { answer: Partial<InspectionAnswer>; files: File[] }) => void;
  onReference: (preview: ReferencePreview) => void;
}) {
  const [rackHint, setRackHint] = useState(answer?.rackHint || answer?.locationHint || "");
  const [cageNumber, setCageNumber] = useState(answer?.cageNumber || "");
  const [animalIdentifier, setAnimalIdentifier] = useState(answer?.animalIdentifier || "");
  const [note, setNote] = useState(answer?.note || "");
  const [subOption, setSubOption] = useState(answer?.subOption || "");
  const [files, setFiles] = useState<File[]>([]);
  const images = node.config?.referenceImages || [];
  const confirmFinding = () =>
    onConfirm({
      answer: {
        locationHint: formatLocationHint(rackHint, cageNumber),
        rackHint,
        cageNumber,
        animalIdentifier,
        note,
        subOption,
      },
      files,
    });

  return (
    <Modal
      centered
      className="inspection-finding-modal"
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={confirmFinding}>
            确认异常
          </Button>
        </Space>
      }
      onCancel={onClose}
      open
      title={
        <div className="inspection-finding-modal-title">
          <div>
            <span>异常登记</span>
            <strong>{node.name}</strong>
            <small>{node.description || "补充异常定位和现场说明。"}</small>
          </div>
          {images.length ? (
            <Button size="small" onClick={() => onReference({ images, initialIndex: 0, title: node.name })}>
              图例 {images.length}
            </Button>
          ) : null}
        </div>
      }
      width={720}
    >
      <div className="inspection-finding-modal-body">
        {images.length ? (
          <section className="inspection-reference-strip" aria-label="参考图例">
            <div>
              <strong>参考图例</strong>
              <span>{node.config?.referenceOrigin === "same_name" ? "同类指标共享" : "当前指标"}</span>
            </div>
            <div className="inspection-reference-images">
              {images.map((image, index) => (
                <Button
                  aria-label={`放大查看${image.desc || node.name}`}
                  className="inspection-reference-button"
                  key={image.url}
                  onClick={() => onReference({ images, initialIndex: index, title: node.name })}
                >
                  <img alt={image.desc || node.name} src={image.url} />
                </Button>
              ))}
            </div>
          </section>
        ) : null}
        <Form layout="vertical">
          <div className="inspection-location-grid">
            <Form.Item label="笼架">
              <Input value={rackHint} onChange={(event) => setRackHint(event.target.value)} />
            </Form.Item>
            <Form.Item label="笼号">
              <Input value={cageNumber} onChange={(event) => setCageNumber(event.target.value)} />
            </Form.Item>
          </div>
          <Form.Item label="动物标识">
            <Input value={animalIdentifier} onChange={(event) => setAnimalIdentifier(event.target.value)} />
          </Form.Item>
          <Form.Item label="现场说明">
            <Input.TextArea value={note} onChange={(event) => setNote(event.target.value)} />
          </Form.Item>
          {node.config?.subOptions?.length ? (
            <Form.Item label="异常类型">
              <Select
                allowClear
                options={node.config.subOptions.map((option) => ({
                  label: option.label || option.nameCn || option.name || option.value || option.id,
                  value: option.value || option.id || "",
                }))}
                placeholder="请选择异常类型"
                value={subOption || undefined}
                onChange={(value) => setSubOption(value || "")}
              />
            </Form.Item>
          ) : null}
          <Form.Item extra="最多 3 张，单张不超过 10 MB。" label="现场照片">
            <Upload
              accept="image/jpeg,image/png,image/webp"
              beforeUpload={() => false}
              fileList={
                files.map((file) => ({
                  uid: `${file.name}-${file.lastModified}`,
                  name: file.name,
                  status: "done",
                })) as UploadFile[]
              }
              listType="text"
              maxCount={3}
              multiple
              onChange={({ fileList }) =>
                setFiles(
                  fileList
                    .reduce<File[]>((next, item) => {
                      if (item.originFileObj) next.push(item.originFileObj);
                      return next;
                    }, [])
                    .slice(0, 3),
                )
              }
            />
          </Form.Item>
        </Form>
        {node.config?.suggestionMeasure ? (
          <p className="inspection-suggestion">
            <strong>参考处置：</strong>
            {node.config.suggestionMeasure}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function ReferenceImageDialog({ preview, onClose }: { preview: ReferencePreview; onClose: () => void }) {
  return (
    <Modal
      centered
      className="inspection-image-modal"
      footer={null}
      onCancel={onClose}
      open
      title={
        <span>
          {preview.title}
          {preview.images.length > 1 ? <small>{preview.images.length} 张参考图例</small> : null}
        </span>
      }
      width={Math.min(920, typeof window === "undefined" ? 920 : window.innerWidth - 32)}
    >
      <Image.PreviewGroup>
        <div className="inspection-image-gallery" aria-label="参考图例列表">
          {preview.images.map((image, index) => (
            <figure key={image.url}>
              <Image
                alt={image.desc || `${preview.title}图例 ${index + 1}`}
                preview={{ mask: "放大查看" }}
                src={image.url}
              />
              <figcaption>{image.desc || `图例 ${index + 1}`}</figcaption>
            </figure>
          ))}
        </div>
      </Image.PreviewGroup>
    </Modal>
  );
}

function formatLocationHint(rackHint: string, cageNumber: string) {
  return [rackHint && `笼架 ${rackHint}`, cageNumber && `笼号 ${cageNumber}`].filter(Boolean).join(" · ");
}
