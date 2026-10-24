import { Space } from "antd";
import { Modal } from "../../../components/ui/Modal";
import { useMemo, useState } from "react";
import type { QuantitySheet } from "../../../api/contracts";
import { ActionButton } from "../../../components/ui";
import { PageSkeleton } from "../../../components/WorkspaceUi";
import { openQuantitySheetsPrint, quantitySheetPagesMarkup } from "../../../print/quantitySheets";
import { usePdfExport } from "../hooks/usePdfExport";

export function QuantityPreviewModal({
  sheet,
  loading,
  onClose,
}: {
  sheet?: QuantitySheet;
  loading: boolean;
  onClose: () => void;
}) {
  const [exportError, setExportError] = useState("");
  const pdfExport = usePdfExport();

  async function exportSheet() {
    if (!sheet) return;
    setExportError("");
    try {
      await pdfExport.exportPdf({ kind: "quantity_sheet", ids: [sheet.id] });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "PDF 导出失败");
    }
  }

  return (
    <Modal
      className="quantity-react-preview"
      footer={
        <Space wrap>
          <ActionButton
            className="info-button"
            disabled={!sheet}
            onClick={() => sheet && openQuantitySheetsPrint([sheet])}
          >
            打印
          </ActionButton>
          <ActionButton
            className="info-button"
            disabled={!sheet || pdfExport.isExporting}
            loading={pdfExport.isExporting}
            onClick={() => void exportSheet()}
          >
            {pdfExport.isExporting ? "正在生成…" : "导出 PDF"}
          </ActionButton>
          <ActionButton onClick={onClose}>关闭</ActionButton>
        </Space>
      }
      onCancel={onClose}
      open
      title={sheet ? `${sheet.month} · ${sheet.iacuc}` : "预览数量统计表"}
      width="min(1120px, calc(100vw - 32px))"
    >
      {pdfExport.isExporting || exportError ? (
        <div className="react-inline-notice" role="status" aria-live="polite">
          {exportError || "PDF 正在后台生成，完成后会自动下载。"}
        </div>
      ) : null}
      {loading || !sheet ? (
        <PageSkeleton compact label="数量统计表预览" rows={4} variant="detail" />
      ) : (
        <QuantityPreview sheet={sheet} />
      )}
    </Modal>
  );
}

function QuantityPreview({ sheet }: { sheet: QuantitySheet }) {
  const markup = useMemo(() => quantitySheetPagesMarkup([sheet]), [sheet]);
  return <div className="quantity-stat-preview" dangerouslySetInnerHTML={{ __html: markup }} />;
}
