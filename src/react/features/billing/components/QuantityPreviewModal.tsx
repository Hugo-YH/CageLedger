import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import { Alert, Button, Space } from "antd";
import { Modal } from "../../../components/ui/Modal";
import { useMemo } from "react";
import type { QuantitySheet } from "../../../api/contracts";
import { ActionButton } from "../../../components/ui";
import { PageSkeleton } from "../../../components/WorkspaceUi";
import { openQuantitySheetsPrint, quantitySheetPagesMarkup } from "../../../print/quantitySheets";
import { usePdfExport } from "../hooks/usePdfExport";

export function QuantityPreviewModal({
  sheet,
  loading,
  error = "",
  onRetry,
  onClose,
}: {
  sheet?: QuantitySheet;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const feedback = useOperationFeedback();
  const pdfExport = usePdfExport();

  async function exportSheet() {
    if (!sheet) return;
    try {
      await pdfExport.exportPdf({ kind: "quantity_sheet", ids: [sheet.id] });
    } catch {
      // The shared task notification owns the export failure and retry result.
    }
  }

  return (
    <Modal
      className="quantity-react-preview"
      footer={
        <Space wrap>
          <ActionButton
            className="info-button"
            disabled={!sheet || Boolean(error)}
            onClick={() => {
              if (!sheet) return;
              if (openQuantitySheetsPrint([sheet])) feedback.info("已打开打印窗口", "请在打印窗口中完成打印。");
              else feedback.error("未能打开打印窗口", "请允许浏览器弹出窗口后重试。");
            }}
          >
            打印
          </ActionButton>
          <ActionButton
            className="info-button"
            disabled={!sheet || Boolean(error) || pdfExport.isExporting}
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
      {error ? (
        <Alert
          role="alert"
          showIcon
          type="error"
          title="数量统计表详情读取失败"
          description={error}
          action={<Button onClick={onRetry}>重试读取</Button>}
        />
      ) : null}
      {loading || (!sheet && !error) ? (
        <PageSkeleton compact label="数量统计表预览" rows={4} variant="detail" />
      ) : sheet ? (
        <QuantityPreview sheet={sheet} />
      ) : null}
    </Modal>
  );
}

function QuantityPreview({ sheet }: { sheet: QuantitySheet }) {
  const markup = useMemo(() => quantitySheetPagesMarkup([sheet]), [sheet]);
  return <div className="quantity-stat-preview" dangerouslySetInnerHTML={{ __html: markup }} />;
}
