import { useEffect, useState } from "react";

import type { InspectionAnswer, InspectionCatalogNode } from "../../api/contracts";
import { ModalShell } from "../../components/WorkspaceUi";

export type ReferencePreview = {
  images: Array<{ url: string; desc?: string }>;
  initialIndex: number;
  title: string;
};

export function FindingCaptureDialog({
  node,
  score,
  answer,
  onClose,
  onConfirm,
  onReference,
}: {
  node: InspectionCatalogNode;
  score: 1 | 2;
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
  return (
    <ModalShell ariaLabel="登记异常" className="inspection-finding-dialog" onClose={onClose}>
      <div className="modal-head">
        <div>
          <span className="workspace-kicker">{score === 1 ? "严重异常 · 1 分" : "轻微异常 · 2 分"}</span>
          <h2>{node.name}</h2>
          <p>{node.description || "补充异常定位和现场说明。"}</p>
        </div>
        {images.length ? (
          <button
            className="inspection-reference-trigger"
            type="button"
            onClick={() => onReference({ images, initialIndex: 0, title: node.name })}
          >
            图例 {images.length}
          </button>
        ) : null}
      </div>
      <div className="modal-body">
        {images.length ? (
          <section className="inspection-reference-strip" aria-label="参考图例">
            <div>
              <strong>参考图例</strong>
              <span>{node.config?.referenceOrigin === "same_name" ? "同类指标共享" : "当前指标"}</span>
            </div>
            <div className="inspection-reference-images">
              {images.map((image, index) => (
                <button
                  aria-label={`放大查看${image.desc || node.name}`}
                  className="inspection-reference-button"
                  key={image.url}
                  type="button"
                  onClick={() => onReference({ images, initialIndex: index, title: node.name })}
                >
                  <img alt={image.desc || node.name} src={image.url} />
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <div className="inspection-location-grid">
          <label>
            笼架
            <input value={rackHint} onChange={(event) => setRackHint(event.target.value)} />
          </label>
          <label>
            笼号
            <input value={cageNumber} onChange={(event) => setCageNumber(event.target.value)} />
          </label>
        </div>
        <label>
          动物标识
          <input value={animalIdentifier} onChange={(event) => setAnimalIdentifier(event.target.value)} />
        </label>
        <label>
          现场说明
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {node.config?.subOptions?.length ? (
          <label>
            异常类型
            <select value={subOption} onChange={(event) => setSubOption(event.target.value)}>
              <option value="">请选择异常类型</option>
              {node.config.subOptions.map((option) => (
                <option
                  key={option.value || option.id || option.nameCn || option.name}
                  value={option.value || option.id || ""}
                >
                  {option.label || option.nameCn || option.name || option.value || option.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          现场照片
          <input
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            multiple
            type="file"
            onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 3))}
          />
          <small>最多 3 张，单张不超过 10 MB。</small>
        </label>
        {node.config?.suggestionMeasure ? (
          <p className="inspection-suggestion">
            <strong>参考处置：</strong>
            {node.config.suggestionMeasure}
          </p>
        ) : null}
      </div>
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={onClose}>
          取消
        </button>
        <button
          className="primary"
          type="button"
          onClick={() =>
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
            })
          }
        >
          确认异常
        </button>
      </div>
    </ModalShell>
  );
}

export function ReferenceImageDialog({ preview, onClose }: { preview: ReferencePreview; onClose: () => void }) {
  const [enlargedIndex, setEnlargedIndex] = useState<number | null>(null);
  useEffect(() => setEnlargedIndex(null), [preview]);
  const enlarged = enlargedIndex === null ? null : preview.images[enlargedIndex];
  return (
    <ModalShell ariaLabel="参考图例放大查看" className="inspection-image-dialog" onClose={onClose}>
      <div className="modal-head">
        <div>
          <h2>{enlarged?.desc || preview.title}</h2>
          {preview.images.length > 1 ? <p>{preview.images.length} 张参考图例</p> : null}
        </div>
        <div className="inspection-image-dialog-actions">
          {enlarged ? (
            <button
              className="ghost inspection-image-dialog-close"
              type="button"
              onClick={() => setEnlargedIndex(null)}
            >
              返回图例
            </button>
          ) : null}
          <button className="secondary inspection-image-dialog-close" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <div className="inspection-image-dialog-body">
        {enlarged ? (
          <img alt={enlarged.desc || preview.title} src={enlarged.url} />
        ) : (
          <div className="inspection-image-dialog-gallery" aria-label="参考图例列表">
            {preview.images.map((image, index) => (
              <button
                aria-label={`放大查看图例 ${index + 1}${image.desc ? `：${image.desc}` : ""}`}
                key={image.url}
                type="button"
                onClick={() => setEnlargedIndex(index)}
              >
                <img alt={image.desc || `${preview.title}图例 ${index + 1}`} src={image.url} />
                <span>{image.desc || `图例 ${index + 1}`}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function formatLocationHint(rackHint: string, cageNumber: string) {
  return [rackHint && `笼架 ${rackHint}`, cageNumber && `笼号 ${cageNumber}`].filter(Boolean).join(" · ");
}
