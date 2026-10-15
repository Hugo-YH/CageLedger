import { Collapse, Descriptions, Empty, Tag, Typography } from "antd";
import { useDataQualityIssue } from "../../../api/dataQuality";
import { formatDateTime, ModalShell, PageSkeleton, PageState } from "../../../components/WorkspaceUi";
import { ActionButton } from "../../../components/ui";

const labels: Record<string, string> = {
  occupancyPayloadText: "占用记录快照",
  missingSlotId: "缺失笼位编号",
  taskPayloadText: "进驻任务快照",
  missingBatchId: "缺失批次编号",
  batchId: "接收批次编号",
  batchPayloadText: "接收批次快照",
  missingReceiptId: "缺失接收明细编号",
  historicalReceiptSnapshots: "审计中的接收明细快照",
  alias: "旧二维码别名",
  cards: "关联笼卡快照",
  id: "应收编号",
  workflowId: "来源流程编号",
  payloadText: "历史应收快照",
  confirmedAllocations: "已确认核销条数",
};
function evidenceText(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2) ?? "";
}

function snapshotFields(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const record: unknown = JSON.parse(value);
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const fields: Record<string, string> = {
      id: "记录编号",
      iacuc: "IACUC",
      project: "项目",
      pi: "项目负责人",
      batchNo: "批次号",
      roomName: "房间",
      sourceBatchId: "来源批次",
      sourceReceiptId: "来源接收明细",
      month: "月份",
    };
    return Object.entries(fields).flatMap(([key, label]) => {
      const item: unknown = (record as Record<string, unknown>)[key];
      return typeof item === "string" || typeof item === "number" ? [{ key, label, children: String(item) }] : [];
    });
  } catch {
    return [];
  }
}

export function DataQualityDetail({
  selection,
  onClose,
}: {
  selection: { scanId: string; issueId: string };
  onClose: () => void;
}) {
  const query = useDataQualityIssue(selection.scanId, selection.issueId);
  const detail = query.data;
  const entries =
    detail?.evidence && typeof detail.evidence === "object" && !Array.isArray(detail.evidence)
      ? Object.entries(detail.evidence)
      : detail
        ? [["留档证据", detail.evidence] as const]
        : [];
  return (
    <ModalShell
      ariaLabel="核查留档详情"
      className="data-quality-detail-modal"
      width="min(900px, calc(100vw - 32px))"
      onClose={onClose}
    >
      <div className="modal-shell-head">
        <div>
          <h2>核查留档详情</h2>
          <p>核查时的记录与证据，仅供查看</p>
        </div>
        <ActionButton aria-label="关闭" onClick={onClose}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body" data-feature="administration">
        {query.isPending ? (
          <PageSkeleton label="留档证据" variant="form" />
        ) : query.isError ? (
          <PageState title="留档证据加载失败" detail={query.error.message} retry={() => query.refetch()} />
        ) : detail ? (
          <>
            <Typography.Paragraph strong>{detail.item.summary}</Typography.Paragraph>
            <Descriptions
              title="关联记录"
              column={1}
              size="small"
              bordered
              items={[
                { key: "code", label: "问题分类", children: detail.item.codeLabel },
                { key: "status", label: "留档分类", children: detail.item.reviewStatusLabel },
                {
                  key: "entity",
                  label: detail.item.entityTypeLabel,
                  children: <Typography.Text>{detail.item.entityId}</Typography.Text>,
                },
                { key: "reference", label: "引用记录", children: detail.item.referenceId || "未记录" },
                { key: "time", label: "核查时间", children: formatDateTime(detail.scan.scannedAt) },
              ]}
            />
            <Typography.Title level={5}>
              留档证据 <Tag color="success">证据校验通过</Tag>
            </Typography.Title>
            {entries.length ? (
              <Collapse
                items={entries.map(([key, value]) => ({
                  key,
                  label: labels[key] || key,
                  children: (
                    <>
                      {snapshotFields(value).length ? (
                        <Descriptions column={1} size="small" items={snapshotFields(value)} />
                      ) : null}
                      <pre className="data-quality-evidence">{evidenceText(value)}</pre>
                    </>
                  ),
                }))}
              />
            ) : (
              <Empty description="留档未提供附加证据" />
            )}
            <Collapse
              className="data-quality-archive-info"
              items={[
                {
                  key: "archive",
                  label: "核查留档信息",
                  children: (
                    <Descriptions
                      column={1}
                      size="small"
                      bordered
                      items={[
                        { key: "scan", label: "留档编号", children: detail.scan.id },
                        { key: "detector", label: "检查器版本", children: detail.scan.detectorVersion },
                        {
                          key: "business",
                          label: "当时最新业务写入",
                          children: detail.scan.latestBusinessAt
                            ? formatDateTime(detail.scan.latestBusinessAt)
                            : "未记录",
                        },
                        {
                          key: "source",
                          label: detail.scan.sourceSnapshot ? "核查输入指纹" : "来源备份指纹",
                          children: detail.scan.sourceSha256,
                        },
                        { key: "evidence", label: "证据指纹", children: detail.evidenceSha256 },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </>
        ) : null}
      </div>
    </ModalShell>
  );
}
