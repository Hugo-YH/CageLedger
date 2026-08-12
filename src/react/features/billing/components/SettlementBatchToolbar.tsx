import { DownloadOutlined, FileTextOutlined, PlayCircleOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip, Typography } from "antd";

export function SettlementBatchToolbar({
  total,
  selectedCount,
  selectingAll,
  pdfExporting,
  xlsxExporting,
  batchStarting,
  batchWithdrawing,
  withdrawableCount,
  allSelectedNonInitiative,
  onExportPdf,
  onExportXlsx,
  onWithdraw,
  onInitiate,
}: {
  total: number;
  selectedCount: number;
  selectingAll: boolean;
  pdfExporting: boolean;
  xlsxExporting: boolean;
  batchStarting: boolean;
  batchWithdrawing: boolean;
  withdrawableCount: number;
  allSelectedNonInitiative: boolean;
  onExportPdf: () => void;
  onExportXlsx: () => void;
  onWithdraw: () => void;
  onInitiate: () => void;
}) {
  const empty = !selectedCount || selectingAll;
  return (
    <div className="settlement-action-bar" aria-label="结算批量操作">
      <Typography.Text type={selectedCount ? undefined : "secondary"}>
        {selectingAll ? `正在选择全部 ${total} 项` : `已选 ${selectedCount} 项`}
      </Typography.Text>
      <Space wrap>
        <Button icon={<DownloadOutlined aria-hidden />} loading={pdfExporting} disabled={empty} onClick={onExportPdf}>
          {selectedCount > 1 ? "批量导出 PDF" : "导出 PDF"}
        </Button>
        <Button icon={<FileTextOutlined aria-hidden />} loading={xlsxExporting} disabled={empty} onClick={onExportXlsx}>
          {selectedCount > 1 ? "批量导出 Excel" : "导出 Excel"}
        </Button>
        <Tooltip title={selectedCount && !withdrawableCount ? "所选结算项均为未发起或已归档，无法撤回" : undefined}>
          <span>
            <Button
              danger
              icon={<UndoOutlined aria-hidden />}
              loading={batchWithdrawing}
              disabled={empty || !withdrawableCount}
              onClick={onWithdraw}
            >
              {withdrawableCount > 1 ? "批量撤回" : "撤回"}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={allSelectedNonInitiative ? "所选结算项均已发起或已归档" : undefined}>
          <span>
            <Button
              icon={<PlayCircleOutlined aria-hidden />}
              loading={batchStarting}
              type="primary"
              disabled={empty || allSelectedNonInitiative}
              onClick={onInitiate}
            >
              {selectedCount > 1 ? "批量发起结算" : "发起结算流程"}
            </Button>
          </span>
        </Tooltip>
      </Space>
    </div>
  );
}
