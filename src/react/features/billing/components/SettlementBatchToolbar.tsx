import { DownloadOutlined, FileTextOutlined, PlayCircleOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Tooltip, Typography } from "antd";

import { CommandBar } from "../../../components/ui";

export function SettlementBatchToolbar({
  total,
  disabled = false,
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
  onClear,
}: {
  total: number;
  disabled?: boolean;
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
  onClear: () => void;
}) {
  const empty = disabled || !selectedCount || selectingAll;
  return (
    <CommandBar
      className="settlement-action-bar"
      ariaLabel="结算批量操作"
      sticky="selection"
      selection={{
        count: selectedCount,
        onClear,
        pending: selectingAll || pdfExporting || xlsxExporting || batchStarting || batchWithdrawing,
      }}
      context={
        <Typography.Text type="secondary">
          {selectingAll ? `正在选择全部 ${total} 项` : `共 ${total} 项`}
        </Typography.Text>
      }
      actions={
        <>
          <Button icon={<DownloadOutlined aria-hidden />} loading={pdfExporting} disabled={empty} onClick={onExportPdf}>
            {selectedCount > 1 ? "批量导出 PDF" : "导出 PDF"}
          </Button>
          <Button
            icon={<FileTextOutlined aria-hidden />}
            loading={xlsxExporting}
            disabled={empty}
            onClick={onExportXlsx}
          >
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
        </>
      }
      primaryAction={
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
      }
    />
  );
}
