import { DownloadOutlined, PlayCircleOutlined, PrinterOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Space, Tooltip, Typography } from "antd";

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
  onClose,
  onExportPdf,
  onStartSettlement,
}: {
  selected: SettlementCandidate;
  result: BillingStatementResponse;
  notice: string;
  noticeKind: "success" | "error" | "info";
  generatePending: boolean;
  pdfExporting: boolean;
  hasWorkflow: boolean;
  onClose: () => void;
  onExportPdf: () => void;
  onStartSettlement: () => void;
}) {
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
          <Tooltip title={hasWorkflow ? "该负责人本月已发起结算流程" : undefined}>
            <span>
              <Button
                icon={<PlayCircleOutlined aria-hidden />}
                loading={generatePending}
                type="primary"
                disabled={hasWorkflow}
                onClick={onStartSettlement}
              >
                {hasWorkflow ? "已发起结算流程" : "发起结算流程"}
              </Button>
            </span>
          </Tooltip>
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
