import { Card, Table, Typography } from "antd";

import type { SystemPerformance } from "../../../api/contracts";
import { formatCount, formatMilliseconds } from "../systemStatus";

const labels: Record<string, string> = {
  "database.fetch": "结果取数",
  "payload.decode": "JSON 解码",
  "response.encode": "响应编码",
  "response.compress": "响应压缩",
  "cache.size": "缓存体积估算",
  "cache.wait": "缓存构建等待",
  "heavy.wait": "文档资源等待",
  "pdf.maintenance": "PDF 缓存维护",
};

export function PerformanceStagesCard({ performance }: { performance: SystemPerformance }) {
  const data = Object.entries(performance.stages ?? {})
    .filter(([key]) => key in labels)
    .map(([key, stage]) => ({ key, label: labels[key], ...stage }));
  const work = performance.documentWork;
  return (
    <Card title="处理阶段">
      <Typography.Paragraph type="secondary">
        取数与解码单独计时；各阶段包含不同数量的操作，其 P95 不相加。
      </Typography.Paragraph>
      <Table
        size="small"
        pagination={false}
        scroll={{ x: 720 }}
        rowKey="key"
        dataSource={data}
        locale={{ emptyText: "暂无处理阶段样本" }}
        columns={[
          { title: "阶段", dataIndex: "label" },
          { title: "累计次数", dataIndex: "operations", render: formatCount, align: "right" },
          { title: "P95", dataIndex: "p95Ms", render: formatMilliseconds, align: "right" },
        ]}
      />
      {work && (
        <Typography.Paragraph type="secondary">
          文档处理：运行 {work.active}/{work.capacity}，等待 {work.waiting}，繁忙拒绝累计 {work.rejected} 次。
        </Typography.Paragraph>
      )}
    </Card>
  );
}
