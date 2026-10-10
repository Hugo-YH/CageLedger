import { DownloadOutlined, PlayCircleOutlined, PrinterOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Tooltip, Typography } from "antd";
import { useState } from "react";

import type { BillingStatementResponse, SettlementCandidate } from "../../../api/contracts";
import { CommandBar } from "../../../components/ui";
import { openSettlementPrint, settlementStatementHtml } from "../../../print/settlement";
import { BatchWithdrawConfirmModal } from "./BatchWithdrawConfirmModal";

export function SettlementPreviewModal({
  selected,
  result,
  notice,
  noticeKind,
  generatePending,
  pdfExporting,
  hasWorkflow,
  workflowStatus,
  revertPending,
  canWithdraw,
  onClose,
  onExportPdf,
  onRevert,
  onStartSettlement,
}: {
  selected: SettlementCandidate;
  result: BillingStatementResponse;
  notice: string;
  noticeKind: "success" | "error" | "info";
  generatePending: boolean;
  pdfExporting: boolean;
  hasWorkflow: boolean;
  workflowStatus?: string;
  revertPending: boolean;
  canWithdraw: boolean;
  onClose: () => void;
  onExportPdf: () => void;
  onRevert: (note: string) => Promise<void>;
  onStartSettlement: () => void;
}) {
  const canInitiate = !hasWorkflow || workflowStatus === "statement_generated";
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const workflowActionLabel = canInitiate
    ? "发起结算流程"
    : {
        statement_sent: "已发起结算流程",
        statement_archived: "已归档结算流程",
      }[workflowStatus || ""] || "已发起结算流程";
  const workflowTooltip = canInitiate
    ? undefined
    : {
        statement_sent: "该负责人本月已发起结算流程",
        statement_archived: "该负责人本月已归档结算流程",
      }[workflowStatus || ""] || "该负责人本月已发起结算流程";
  return (
    <Modal
      open
      rootClassName="app-modal-root settlement-preview-modal"
      title={`${selected.pi} · ${selected.month}`}
      width={1200}
      footer={null}
      onCancel={onClose}
    >
      <CommandBar
        className="settlement-preview-toolbar"
        ariaLabel="结算单预览操作"
        context={
          <div className="settlement-preview-toolbar-context">
            <Typography.Text className="settlement-preview-toolbar-label" strong type="secondary">
              伦理号
            </Typography.Text>
            <Typography.Text className="settlement-preview-toolbar-values" type="secondary">
              {selected.iacucs.join("、")}
            </Typography.Text>
          </div>
        }
        actions={
          <>
            <Button icon={<PrinterOutlined aria-hidden />} onClick={() => openSettlementPrint(result)}>
              打印结算单
            </Button>
            <Button icon={<DownloadOutlined aria-hidden />} loading={pdfExporting} onClick={onExportPdf}>
              导出 PDF
            </Button>
            {canWithdraw && hasWorkflow && workflowStatus === "statement_sent" ? (
              <Button
                danger
                icon={<UndoOutlined aria-hidden />}
                loading={revertPending}
                onClick={() => setWithdrawOpen(true)}
              >
                撤回
              </Button>
            ) : null}
          </>
        }
        primaryAction={
          <Tooltip title={workflowTooltip}>
            <span>
              <Button
                icon={<PlayCircleOutlined aria-hidden />}
                loading={generatePending}
                type="primary"
                disabled={!canInitiate}
                onClick={onStartSettlement}
              >
                {workflowActionLabel}
              </Button>
            </span>
          </Tooltip>
        }
      />
      {notice ? (
        <Alert
          title={notice}
          role="status"
          showIcon
          type={noticeKind === "error" ? "error" : noticeKind === "success" ? "success" : "info"}
        />
      ) : null}
      <div className="settlement-preview settlement-document-preview">
        <iframe title="结算单预览" srcDoc={settlementStatementHtml(result, false)} />
      </div>
      <BatchWithdrawConfirmModal
        count={1}
        open={withdrawOpen}
        pending={revertPending}
        title="撤回结算流程"
        onCancel={() => setWithdrawOpen(false)}
        onConfirm={onRevert}
      />
    </Modal>
  );
}
