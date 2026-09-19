import { DownloadOutlined, PlayCircleOutlined, PrinterOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Popconfirm, Tooltip, Typography } from "antd";

import type { BillingStatementResponse, SettlementCandidate } from "../../../api/contracts";
import { CommandBar } from "../../../components/ui";
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
  revertPending,
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
  onClose: () => void;
  onExportPdf: () => void;
  onRevert: () => void;
  onStartSettlement: () => void;
}) {
  const canInitiate = !hasWorkflow || workflowStatus === "statement_generated";
  const canWithdraw = hasWorkflow && workflowStatus === "statement_sent";
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
            {canWithdraw ? (
              <Popconfirm
                description="撤回后该结算流程退回已生成状态，可重新发起结算。"
                okButtonProps={{ danger: true }}
                okText="撤回"
                title="将该流程撤回？"
                onConfirm={onRevert}
              >
                <Button danger icon={<UndoOutlined aria-hidden />} loading={revertPending}>
                  撤回
                </Button>
              </Popconfirm>
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
    </Modal>
  );
}
