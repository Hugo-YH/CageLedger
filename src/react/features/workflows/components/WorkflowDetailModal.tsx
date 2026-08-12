import { DownloadOutlined } from "@ant-design/icons";
import { Button, Descriptions, Flex, Modal, Typography } from "antd";

import type { BillingWorkflow } from "../../../api/workflows";
import { formatDateTime, formatMoney } from "../../../components/WorkspaceUi";

export function WorkflowDetailModal({ target, onCancel }: { target: BillingWorkflow | null; onCancel: () => void }) {
  return (
    <Modal
      footer={null}
      open={Boolean(target)}
      title={`流程留档 · ${target?.month ?? ""} ${target?.pi ?? ""}`}
      width={680}
      onCancel={onCancel}
    >
      {target ? (
        <>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="结算金额">{formatMoney(Number(target.totalAmount || 0))}</Descriptions.Item>
            <Descriptions.Item label="实收金额">{formatMoney(Number(target.receivedAmount || 0))}</Descriptions.Item>
            <Descriptions.Item label="报销单号">
              {target.reimbursementForms?.length
                ? target.reimbursementForms
                    .map((entry) => `${entry.formNo}（${formatMoney(Number(entry.amount || 0))}）`)
                    .join("、")
                : (target.reimbursementFormNos || []).join("、") || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="是否交回签字结算单">
              {target.signedStatementReturned ? "是" : "否"}
            </Descriptions.Item>
            <Descriptions.Item label="是否交回报销单">
              {target.reimbursementFormReturned ? "是" : "否"}
            </Descriptions.Item>
            <Descriptions.Item label="登记人">{target.registeredBy?.displayName || "-"}</Descriptions.Item>
            <Descriptions.Item label="登记时间">
              {target.registeredAt ? formatDateTime(target.registeredAt) : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="归档时间">
              {target.archivedAt ? formatDateTime(target.archivedAt) : "-"}
            </Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5} style={{ marginTop: 16 }}>
            附件
          </Typography.Title>
          {(target.attachments || []).length ? (
            <Flex vertical gap={8}>
              {(target.attachments || []).map((attachment) => (
                <Button
                  key={attachment.id}
                  icon={<DownloadOutlined aria-hidden />}
                  href={`/api/billing-workflows/attachments/${attachment.id}`}
                  target="_blank"
                  rel="noreferrer"
                  type="link"
                >
                  {attachment.kind === "settlement" ? "饲养费结算单" : "报销单"} · {attachment.originalName}
                </Button>
              ))}
            </Flex>
          ) : (
            <Typography.Text type="secondary">无附件</Typography.Text>
          )}
        </>
      ) : null}
    </Modal>
  );
}
