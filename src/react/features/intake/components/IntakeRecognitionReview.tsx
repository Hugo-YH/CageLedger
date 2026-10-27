import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Collapse, Space, Table, Typography } from "antd";
import { useState, type ReactNode } from "react";
import type { IntakeRecognitionEvidence } from "../../../../contracts/intake";
import { buildRecognitionReview } from "../recognitionReview";

export function IntakeRecognitionReview({
  evidence,
  children,
}: {
  evidence: IntakeRecognitionEvidence;
  children?: ReactNode;
}) {
  // Expansion belongs to the displayed result. A replacement result starts collapsed.
  const [expandedResult, setExpandedResult] = useState<IntakeRecognitionEvidence | null>(null);
  const { comparisons, reminders } = buildRecognitionReview(evidence);
  const count = comparisons.length + reminders.length;
  if (!count && !children) return null;
  return (
    <Collapse
      className="intake-recognition-review"
      size="small"
      activeKey={expandedResult === evidence ? ["review"] : []}
      onChange={(keys) => setExpandedResult(keys.includes("review") ? evidence : null)}
      items={[
        {
          key: "review",
          label: (
            <Space size={8}>
              <ExclamationCircleOutlined aria-hidden className="intake-recognition-review-icon" />
              <span>请核对识别提示{count ? `（${count}项）` : ""}</span>
            </Space>
          ),
          children: (
            <Space orientation="vertical" size={12} className="intake-recognition-review-content">
              {comparisons.length ? (
                <section aria-label="饲养需求与采购信息对照">
                  <Table
                    className="intake-recognition-comparison"
                    size="small"
                    bordered
                    tableLayout="fixed"
                    pagination={false}
                    rowKey="key"
                    dataSource={comparisons}
                    columns={[
                      { title: "核对项目", dataIndex: "label", width: "24%", rowScope: "row" },
                      { title: "饲养需求", dataIndex: "husbandry", width: "38%" },
                      { title: "采购信息", dataIndex: "purchase", width: "38%" },
                    ]}
                  />
                </section>
              ) : null}
              {reminders.length ? (
                <section aria-label="其他核对事项">
                  {comparisons.length ? <Typography.Text strong>其他核对事项</Typography.Text> : null}
                  <ul className="intake-recognition-reminders">
                    {reminders.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {children}
            </Space>
          ),
        },
      ]}
    />
  );
}
