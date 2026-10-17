import { useMemo, type ReactNode } from "react";
import {
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";

import { CommandBar, HelpPopover } from "../../../components/ui";
import type { SettlementCandidate } from "../../../api/contracts";

export function SettlementBatchToolbar({
  filters,
  navigationAction,
  disabled = false,
  selectedCandidates,
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
  onClearSelection,
}: {
  filters?: ReactNode;
  navigationAction?: ReactNode;
  disabled?: boolean;
  selectedCandidates: readonly SettlementCandidate[];
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
  onClearSelection: () => void;
}) {
  const selectedCount = selectedCandidates.length;
  const technicalCount = useMemo(
    () => selectedCandidates.filter((item) => item.feeType === "technical_service").length,
    [selectedCandidates],
  );
  const empty = disabled || !selectedCount || selectingAll;
  return (
    <CommandBar
      title="结算列表"
      filters={filters}
      className="settlement-action-bar app-command-bar-list"
      ariaLabel="结算批量操作"
      sticky={Boolean(
        selectedCount || selectingAll || pdfExporting || xlsxExporting || batchStarting || batchWithdrawing,
      )}
      context={
        <HelpPopover label="结算合表说明" icon={<ExclamationCircleOutlined aria-hidden="true" />}>
          同一负责人、同一月份、同一费用类型下的多个伦理号自动合表。饲养费与技术服务费分别出单。
        </HelpPopover>
      }
      selection={
        selectedCount || selectingAll
          ? {
              count: selectedCount,
              description: selectedCount
                ? `饲养费 ${selectedCount - technicalCount} 项、技术服务费 ${technicalCount} 项`
                : undefined,
              onClear: onClearSelection,
              pending: selectingAll || batchStarting || batchWithdrawing,
              pendingText: selectingAll ? "正在读取筛选结果…" : undefined,
            }
          : undefined
      }
      actions={
        <>
          {navigationAction}
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
          <Tooltip title={selectedCount && !withdrawableCount ? "所选结算项没有可撤回的流程或无撤回权限" : undefined}>
            <span>
              <Button
                icon={<UndoOutlined aria-hidden />}
                danger
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
        <Tooltip title={allSelectedNonInitiative ? "所选结算项均已发起或已登记" : undefined}>
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
