import { DownloadOutlined } from "@ant-design/icons";
import { Button, Collapse, Flex, Modal, Tag, Timeline, Typography } from "antd";

import type { BillingWorkflow, BillingWorkflowEvent } from "../../../api/workflows";
import { formatDateTime, formatMoney } from "../../../components/WorkspaceUi";

function timeLabel(value?: string) {
  return value ? formatDateTime(value) : "-";
}

function detailLine(label: string, value: string) {
  return (
    <div>
      <Typography.Text type="secondary">{label}：</Typography.Text>
      {value || "-"}
    </div>
  );
}

function eventTime(item: { at: string }) {
  return <Typography.Text type="secondary">{timeLabel(item.at)}</Typography.Text>;
}

export function WorkflowDetailModal({
  target,
  onCancel,
}: {
  target: { workflow: BillingWorkflow; events: BillingWorkflowEvent[] } | null;
  onCancel: () => void;
}) {
  const workflow = target?.workflow;
  const revised = Number(workflow?.currentVersionNo || 1) > 1;
  const eventMeta: Record<string, { label: string; personLabel: string }> = {
    statement_sent: { label: "发起结算流程", personLabel: "发起人" },
    statement_registered_archived: { label: "结算单/报销单交回", personLabel: "登记人" },
    statement_archived_reverted: { label: "撤回", personLabel: "操作人" },
    statement_sent_reverted: { label: "撤回", personLabel: "操作人" },
    statement_reimbursement_recorded: { label: "补录报销单", personLabel: "补录人" },
    statement_locked: { label: "锁定", personLabel: "操作人" },
    statement_unlocked: { label: "解锁", personLabel: "操作人" },
  };
  const allEvents = (target?.events || [])
    .filter((event) => eventMeta[event.eventType])
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const lastSent = [...allEvents].reverse().find((event) => event.eventType === "statement_sent");
  const lastRegistered = [...allEvents].reverse().find((event) => event.eventType === "statement_registered_archived");
  const lastLocked = [...allEvents].reverse().find((event) => event.eventType === "statement_locked");
  const lastUnlocked = [...allEvents].reverse().find((event) => event.eventType === "statement_unlocked");
  const effectiveIds = new Set([lastSent?.id, lastRegistered?.id, lastLocked?.id, lastUnlocked?.id].filter(Boolean));
  const historyEvents = allEvents.filter((event) => !effectiveIds.has(event.id));

  const items = [
    {
      color: "var(--primary)",
      title: <Typography.Text type="secondary">{timeLabel(workflow?.sheetUpdatedAt)}</Typography.Text>,
      content: (
        <>
          <Typography.Text strong>数量统计表</Typography.Text>
          {detailLine("登记人员", workflow?.manager || "")}
          {revised ? (
            <>
              {detailLine("更新时间", workflow?.sheetUpdatedAt ? formatDateTime(workflow.sheetUpdatedAt) : "")}
              {detailLine("更新人员", workflow?.manager || "")}
            </>
          ) : null}
        </>
      ),
    },
    {
      color: "var(--primary)",
      title: <Typography.Text type="secondary">{timeLabel(workflow?.generatedAt)}</Typography.Text>,
      content: (
        <>
          <Typography.Text strong>饲养费核算汇总表</Typography.Text>
          {detailLine("生成方式", "系统自动生成")}
          {revised ? (
            <>
              {detailLine("更新时间", workflow?.generatedAt ? formatDateTime(workflow.generatedAt) : "")}
              {detailLine("更新原因", "数量统计表更新后重新生成")}
            </>
          ) : null}
        </>
      ),
    },
    ...allEvents
      .filter((event) => effectiveIds.has(event.id))
      .map((event) => {
        const meta = eventMeta[event.eventType];
        return {
          color: "var(--primary)",
          title: eventTime(event),
          content: (
            <>
              <Typography.Text strong>{meta.label}</Typography.Text>
              {detailLine(meta.personLabel, event.actor?.displayName || "")}
              {event.note ? detailLine("说明", event.note) : null}
              {event.eventType === "statement_registered_archived" ? (
                <>
                  <Flex gap={8} align="center" style={{ margin: "6px 0" }}>
                    <Tag color={workflow?.signedStatementReturned ? "success" : "default"}>
                      {workflow?.signedStatementReturned ? "结算单 ✅ 已交回" : "结算单 未交回"}
                    </Tag>
                    <Tag color={workflow?.reimbursementFormReturned ? "success" : "default"}>
                      {workflow?.reimbursementFormReturned ? "报销单 ✅ 已交回" : "报销单 未交回"}
                    </Tag>
                  </Flex>
                  {detailLine(
                    "报销单号",
                    workflow?.reimbursementForms?.length
                      ? workflow.reimbursementForms
                          .map((entry) => `${entry.formNo}（${formatMoney(Number(entry.amount || 0))}）`)
                          .join("、")
                      : (workflow?.reimbursementFormNos || []).join("、"),
                  )}
                </>
              ) : null}
            </>
          ),
        };
      }),
  ];

  const historyItems = historyEvents.map((event) => {
    const meta = eventMeta[event.eventType];
    return {
      color: "var(--primary)",
      title: eventTime(event),
      content: (
        <>
          <Typography.Text strong>{meta.label}</Typography.Text>
          {detailLine(meta.personLabel, event.actor?.displayName || "")}
          {event.note ? detailLine("说明", event.note) : null}
        </>
      ),
    };
  });

  return (
    <Modal
      footer={null}
      open={Boolean(target)}
      title={`流程记录 · ${workflow?.month ?? ""} ${workflow?.pi ?? ""}`}
      width={720}
      onCancel={onCancel}
    >
      <Timeline className="workflow-timeline" items={items} mode="start" />
      {historyItems.length ? (
        <Collapse
          ghost
          items={[
            {
              key: "history",
              label: `历史记录（${historyItems.length} 条）`,
              children: <Timeline className="workflow-timeline" items={historyItems} mode="start" />,
            },
          ]}
          style={{ marginTop: 4 }}
        />
      ) : null}
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        附件
      </Typography.Title>
      {(workflow?.attachments || []).length ? (
        <Flex vertical gap={8}>
          {(workflow?.attachments || []).map((attachment) => (
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
    </Modal>
  );
}
