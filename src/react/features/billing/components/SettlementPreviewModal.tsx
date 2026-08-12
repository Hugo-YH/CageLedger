import { DownloadOutlined, PlayCircleOutlined, PrinterOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Popconfirm, Space, Tooltip, Typography } from "antd";

import type { BillingStatementResponse, SettlementCandidate } from "../../../api/contracts";
import { openSettlementPrint, settlementStatementHtml } from "../../../print/settlement";

export function SettlementPreviewModal({
  selected,
  result,
  notice,
  noticeKind,
  generatePending,
  pdfExporting,
  hasWorkflow,
  workflowStatus,
  withdrawPending,
  revertPending,
  onClose,
  onExportPdf,
  onWithdraw,
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
  withdrawPending: boolean;
  revertPending: boolean;
  onClose: () => void;
  onExportPdf: () => void;
  onWithdraw: () => void;
  onRevert: () => void;
  onStartSettlement: () => void;
}) {
  const canInitiate = !hasWorkflow || workflowStatus === "statement_generated";
  const canWithdraw = hasWorkflow && (workflowStatus === "statement_generated" || workflowStatus === "statement_sent");
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
      onCancel={onClose}
    >
      <div
        className="settlement-preview-toolbar"
        data-ui="workspace-toolbar"
        role="toolbar"
        aria-label="结算单预览操作"
      >
        <Typography.Paragraph
          className="settlement-preview-toolbar-context"
          title={selected.iacucs.join("、")}
          type="secondary"
        >
          {selected.iacucs.join("、")}
        </Typography.Paragraph>
        <Space className="settlement-preview-toolbar-actions" wrap>
          <Button icon={<PrinterOutlined aria-hidden />} onClick={() => openSettlementPrint(result)}>
            打印结算单
          </Button>
          <Button icon={<DownloadOutlined aria-hidden />} loading={pdfExporting} onClick={onExportPdf}>
            导出 PDF
          </Button>
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
          {canWithdraw ? (
            <Popconfirm
              description={
                workflowStatus === "statement_generated"
                  ? "撤回后该负责人本月将回到未发起状态，可重新发起结算。"
                  : "撤回后该结算流程退回已生成状态，可重新发起结算。"
              }
              okButtonProps={{ danger: true }}
              okText="撤回"
              title={workflowStatus === "statement_generated" ? "撤回该结算流程？" : "撤回该已发起的结算流程？"}
              onConfirm={workflowStatus === "statement_generated" ? onWithdraw : onRevert}
            >
              <Button danger icon={<UndoOutlined aria-hidden />} loading={withdrawPending || revertPending}>
                撤回
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </div>
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
    </Modal>
  );
}
