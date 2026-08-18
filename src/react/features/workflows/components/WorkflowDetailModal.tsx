import { DownloadOutlined } from "@ant-design/icons";
import { Button, Flex, Modal, Tag, Timeline, Typography } from "antd";
import { useEffect, useState } from "react";

import { reimbursementReturnStatus } from "../../../../domain/workflowStatus";
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

function registrationReturnedCards(workflow: BillingWorkflow) {
  const forms = workflow.reimbursementForms || [];
  if (!forms.length) {
    return detailLine("报销单号", (workflow.reimbursementFormNos || []).join("、"));
  }
  return (
    <>
      <div className="workflow-reimbursement-cards">
        {forms.map((entry, index) => (
          <div className="workflow-reimbursement-card" key={`${entry.formNo}-${index}`}>
            <Typography.Text strong className="workflow-reimbursement-card-title">
              报销单 {index + 1}
            </Typography.Text>
            {detailLine("报销单号", entry.formNo)}
            {entry.fundingBookNo ? detailLine("经费本编号", entry.fundingBookNo) : null}
            {detailLine("金额（元）", formatMoney(Number(entry.amount || 0)))}
          </div>
        ))}
      </div>
      <div className="workflow-reimbursement-total">
        {detailLine("总金额", formatMoney(Number(workflow.receivedAmount || 0)))}
      </div>
    </>
  );
}

function personName(value: string) {
  return <div>{value || "-"}</div>;
}

function eventTime(item: { at: string }) {
  return <Typography.Text type="secondary">{timeLabel(item.at)}</Typography.Text>;
}

function showEventNote(event: BillingWorkflowEvent) {
  const automaticRevertNotes = ["撤回，退回已发起", "撤回，退回已生成", "批量撤回，退回已发起", "批量撤回，退回已生成"];
  const automaticSentNote = /^按 PI 合表发起 .+ \d{4}-\d{2} 结算流程$/;
  return !(
    (event.eventType === "statement_sent" && automaticSentNote.test(event.note)) ||
    (event.eventType === "statement_locked" && ["锁定结算流程", "批量锁定结算流程"].includes(event.note)) ||
    (event.eventType === "statement_unlocked" && event.note === "解锁结算流程") ||
    ((event.eventType === "statement_archived_reverted" || event.eventType === "statement_sent_reverted") &&
      automaticRevertNotes.includes(event.note))
  );
}

export function WorkflowDetailModal({
  target,
  onCancel,
}: {
  target: { workflow: BillingWorkflow; events: BillingWorkflowEvent[] } | null;
  onCancel: () => void;
}) {
  const workflow = target?.workflow;
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedHistory(new Set());
  }, [target?.workflow.id]);

  const revised = Number(workflow?.currentVersionNo || 1) > 1;
  const reimbursementRequired = workflow?.reimbursementRequired ?? Number(workflow?.totalAmount || 0) > 0;
  const reimbursementStatus = reimbursementReturnStatus(workflow || {});
  const eventMeta: Record<string, { label: string }> = {
    statement_sent: { label: "发起结算流程" },
    statement_registered_archived: { label: "结算单/报销单交回" },
    statement_archived_reverted: { label: "撤回" },
    statement_sent_reverted: { label: "撤回" },
    statement_reimbursement_recorded: { label: "补录报销单" },
    statement_locked: { label: "锁定" },
    statement_unlocked: { label: "解锁" },
  };
  const allEvents = (target?.events || [])
    .filter((event) => eventMeta[event.eventType])
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const lastSent = [...allEvents].reverse().find((event) => event.eventType === "statement_sent");
  const lastRegistered = [...allEvents].reverse().find((event) => event.eventType === "statement_registered_archived");
  const lastLocked =
    workflow?.workflowStatus === "statement_locked"
      ? [...allEvents].reverse().find((event) => event.eventType === "statement_locked")
      : undefined;
  const effectiveIds = new Set([lastSent?.id, lastRegistered?.id, lastLocked?.id].filter(Boolean));
  const historyEvents = allEvents.filter((event) => !effectiveIds.has(event.id));

  const effectiveItems = [
    {
      at: workflow?.sheetUpdatedAt || "",
      color: "var(--primary)",
      title: <Typography.Text type="secondary">{timeLabel(workflow?.sheetUpdatedAt)}</Typography.Text>,
      content: (
        <>
          <Typography.Text strong>录入数量统计表</Typography.Text>
          {personName(workflow?.manager || "")}
          {revised ? (
            <>
              {detailLine("更新时间", workflow?.sheetUpdatedAt ? formatDateTime(workflow.sheetUpdatedAt) : "")}
              {personName(workflow?.manager || "")}
            </>
          ) : null}
        </>
      ),
    },
    {
      at: workflow?.generatedAt || "",
      color: "var(--primary)",
      title: <Typography.Text type="secondary">{timeLabel(workflow?.generatedAt)}</Typography.Text>,
      content: (
        <>
          <Typography.Text strong>生成饲养费汇总表</Typography.Text>
          <div>
            <Typography.Text type="secondary">系统</Typography.Text>
          </div>
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
          at: event.at,
          color: "var(--primary)",
          title: eventTime(event),
          content: (
            <>
              <Typography.Text strong>{meta.label}</Typography.Text>
              {personName(event.actor?.displayName || "")}
              {event.note && showEventNote(event)
                ? detailLine(
                    event.eventType === "statement_archived_reverted" || event.eventType === "statement_sent_reverted"
                      ? "撤回原因"
                      : "说明",
                    event.note,
                  )
                : null}
              {event.eventType === "statement_registered_archived" ? (
                <>
                  <div className="workflow-registration-card">
                    <div className="workflow-registration-status">
                      <Tag color={workflow?.signedStatementReturned ? "success" : "default"}>
                        {workflow?.signedStatementReturned ? "结算单 已交回" : "结算单 未交回"}
                      </Tag>
                    </div>
                    {workflow?.signedStatementNote ? detailLine("备注", workflow.signedStatementNote) : null}
                  </div>
                  {reimbursementRequired ? (
                    <div className="workflow-registration-card">
                      <div className="workflow-registration-status">
                        <Tag color={reimbursementStatus.color}>{reimbursementStatus.label}</Tag>
                      </div>
                      {workflow?.reimbursementFormReturned ? (
                        <>
                          {registrationReturnedCards(workflow)}
                          {workflow?.reimbursementFormNote ? detailLine("备注", workflow.reimbursementFormNote) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ),
        };
      }),
  ];

  const historyTimelineItems = (events: BillingWorkflowEvent[]) => {
    const historyKey = events.map((event) => event.id).join(",");
    const expanded = expandedHistory.has(historyKey);
    const trigger = {
      color: "gray",
      content: (
        <Button
          aria-expanded={expanded}
          className="workflow-history-trigger"
          size="small"
          type="text"
          onClick={() =>
            setExpandedHistory((current) => {
              const next = new Set(current);
              if (expanded) next.delete(historyKey);
              else next.add(historyKey);
              return next;
            })
          }
        >
          {expanded ? "收起历史修改" : `历史修改（${events.length} 条）`}
        </Button>
      ),
    };
    if (expanded) {
      return [
        trigger,
        ...events.map((event) => {
          const meta = eventMeta[event.eventType];
          return {
            color: "gray",
            title: eventTime(event),
            content: (
              <div className="workflow-history-event">
                <Typography.Text strong>{meta.label}</Typography.Text>
                {personName(event.actor?.displayName || "")}
                {event.note && showEventNote(event)
                  ? detailLine(
                      event.eventType === "statement_archived_reverted" || event.eventType === "statement_sent_reverted"
                        ? "撤回原因"
                        : "说明",
                      event.note,
                    )
                  : null}
                {event.signedStatementNote ? detailLine("结算单备注", event.signedStatementNote) : null}
                {event.reimbursementFormNote ? detailLine("报销单备注", event.reimbursementFormNote) : null}
              </div>
            ),
          };
        }),
      ];
    }
    return [trigger];
  };
  const items = effectiveItems.flatMap((item, index) => {
    const previousAt = index ? effectiveItems[index - 1].at : "";
    const historyBeforeItem = historyEvents.filter(
      (event) => (!previousAt || event.at > previousAt) && (!item.at || event.at <= item.at),
    );
    return [...(historyBeforeItem.length ? historyTimelineItems(historyBeforeItem) : []), item];
  });
  const lastEffectiveAt = effectiveItems.at(-1)?.at || "";
  const trailingHistory = historyEvents.filter((event) => !lastEffectiveAt || event.at > lastEffectiveAt);
  if (trailingHistory.length) items.push(...historyTimelineItems(trailingHistory));

  return (
    <Modal
      footer={null}
      rootClassName="workflow-detail-modal"
      open={Boolean(target)}
      title={`流程记录 · ${workflow?.month ?? ""} ${workflow?.pi ?? ""}`}
      width={720}
      onCancel={onCancel}
    >
      <Timeline className="workflow-timeline" items={items} mode="start" />
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
