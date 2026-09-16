import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Pagination,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from "antd";
import type { QuarantineActivity, QuarantineDetail, QuarantinePage } from "../../../contracts/quarantine";
import { useQuarantineQuery } from "../../api/quarantine";
import { methodLabels } from "./shared";
import { speciesLabel } from "../../../domain/intake";

const actionLabels: Record<string, string> = {
  batch_saved: "保存批次",
  test_saved: "保存检测",
  report_issued: "出具报告",
  attachment_uploaded: "上传原始资料",
  attachment_updated: "更新原始资料",
  attachment_removed: "移除原始资料",
  batch_reopened_for_correction: "因更正重新开启批次",
  batch_completed: "确认整批检疫完成",
  correction_created: "创建更正草稿",
  retest_created: "创建复检",
  test_correction: "创建更正草稿",
  test_retest: "创建复检",
};
export function BatchActivity({ batchId }: { batchId: string }) {
  const [page, setPage] = useState(1);
  const query = useQuarantineQuery<QuarantinePage<QuarantineActivity>>(
    `batches/${batchId}/activity?offset=${(page - 1) * 30}`,
  );
  if (query.error)
    return (
      <Alert
        type="error"
        title={query.error.message}
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  return (
    <Space orientation="vertical" className="quarantine-full-width">
      <Typography.Paragraph type="secondary">
        记录保存、原始资料变更和报告出具均保留操作人及时间。已出具报告通过更正建立新版本。
      </Typography.Paragraph>
      {query.data?.items.length ? (
        <Timeline
          items={query.data.items.map((event) => ({
            key: event.id,
            content: (
              <>
                <Typography.Text strong>
                  {actionLabels[event.action.replace("quarantine.", "")] ?? event.action.replace("quarantine.", "")}
                </Typography.Text>
                <p>
                  {event.actor} · {event.at.replace("T", " ").slice(0, 19)}
                </p>
              </>
            ),
          }))}
        />
      ) : (
        <Empty description={query.isPending ? "正在读取操作历史" : "暂无操作历史"} />
      )}
      <Pagination
        size="small"
        current={page}
        total={query.data?.page.total}
        pageSize={30}
        showSizeChanger={false}
        onChange={setPage}
      />
    </Space>
  );
}

export function BatchOverview({
  detail,
  compact = false,
  onRecord,
}: {
  detail: QuarantineDetail;
  compact?: boolean;
  onRecord: (id: string) => void;
}) {
  const b = detail.item;
  const sources = (
    <Table
      rowKey="id"
      size="small"
      dataSource={b.sources}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      scroll={{ x: 780 }}
      columns={[
        { title: "供应商", dataIndex: "supplier" },
        {
          title: "动物 / 品系",
          render: (_, s) => `${speciesLabel(s.species)} ${s.strainStandard || s.strainRaw || ""}`,
        },
        { title: "课题组", dataIndex: "pi" },
        { title: "负责人", dataIndex: "owner" },
        { title: "到货批次", dataIndex: "batchNo", render: (value: string) => value || "手工来源" },
        { title: "伦理编号", dataIndex: "iacuc" },
      ]}
    />
  );
  const summary = (
    <Descriptions
      size="small"
      column={{ xs: 1, sm: 2, lg: 3 }}
      items={[
        {
          key: "state",
          label: "检疫状态",
          children: <Tag color={b.completedAt ? "success" : "processing"}>{b.completedAt ? "已检疫" : "检疫中"}</Tag>,
        },
        { key: "sources", label: "覆盖来源", children: `${b.sources.length} 项` },
        { key: "records", label: "检测记录", children: `${detail.tests.length} 条` },
        { key: "conclusion", label: "最终结论", span: "filled", children: b.conclusion || "尚未填写最终结论" },
        ...(b.handling ? [{ key: "handling", label: "处理说明", span: "filled" as const, children: b.handling }] : []),
      ]}
    />
  );
  if (compact)
    return (
      <Collapse
        className="quarantine-batch-summary"
        items={[
          {
            key: "batch",
            label: (
              <Space>
                <Typography.Text strong>批次概况</Typography.Text>
                <Typography.Text type="secondary">
                  {b.name} · {b.sources.length} 项来源
                </Typography.Text>
              </Space>
            ),
            children: (
              <>
                {summary}
                <Collapse
                  ghost
                  items={[
                    { key: "sources", label: `完整来源（${b.sources.length}）`, children: sources },
                    ...(b.notes
                      ? [
                          {
                            key: "notes",
                            label: "备注",
                            children: (
                              <Typography.Paragraph className="quarantine-batch-summary-text">
                                {b.notes}
                              </Typography.Paragraph>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </>
            ),
          },
        ]}
      />
    );
  return (
    <Card size="small" className="quarantine-batch-summary" title="批次概况">
      {summary}
      <Tabs
        items={[
          {
            key: "records",
            label: `检测记录（${detail.tests.length}）`,
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={detail.tests}
                scroll={{ x: 620 }}
                pagination={false}
                columns={[
                  { title: "检测方法", render: (_, test) => methodLabels[test.method] },
                  { title: "检测日期", dataIndex: "testDate" },
                  {
                    title: "状态",
                    render: (_, test) => (
                      <Tag color={test.state === "issued" ? "success" : "processing"}>
                        {test.state === "issued" ? "已出具" : "草稿"}
                      </Tag>
                    ),
                  },
                  {
                    title: "操作",
                    render: (_, test) => <Button onClick={() => onRecord(test.id)}>查看检测记录</Button>,
                  },
                ]}
              />
            ),
          },
          { key: "sources", label: `来源清单（${b.sources.length}）`, children: sources },
          {
            key: "notes",
            label: "批次备注",
            children: (
              <Typography.Paragraph className="quarantine-batch-summary-text">
                {b.notes || "暂无备注"}
              </Typography.Paragraph>
            ),
          },
          { key: "activity", label: "操作历史", children: <BatchActivity batchId={b.id} /> },
        ]}
      />
    </Card>
  );
}
