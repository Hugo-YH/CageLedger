import { ActionIcon } from "../../components/ui/ActionIcon";
import { Alert, Button, Card, Collapse, Descriptions, Empty, Space, Tag, Typography } from "antd";
import { Modal } from "../../components/ui/Modal";
import { downloadAnimalInspectionPdf, useAnimalInspection } from "../../api/animalManagement";
import { PageSkeleton } from "../../components/WorkspaceUi";
import { FINDING_STATUS_LABELS, summarizeInspectionOutcomes, MODULE_LABELS } from "./model";
import { formatDate } from "./inspectionListFormatting";

export function InspectionDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAnimalInspection(id);
  const outcomeSummary = query.data ? summarizeInspectionOutcomes(query.data.answers, query.data.catalog.nodes) : [];
  const abnormalities = outcomeSummary.flatMap((module) => module.items.filter((item) => item.outcome === "abnormal"));
  return (
    <Modal
      className="inspection-detail-modal"
      destroyOnHidden
      footer={
        <Button icon={<ActionIcon name="download" />} onClick={() => void downloadAnimalInspectionPdf(id)}>
          导出 PDF
        </Button>
      }
      onCancel={onClose}
      open
      title="巡检记录详情"
      width={860}
    >
      {query.isPending ? <PageSkeleton compact label="巡检结论与处置记录" rows={4} variant="detail" /> : null}
      {query.isError || (query.isSuccess && !query.data) ? (
        <Alert
          action={
            <Button icon={<ActionIcon name="refresh" />} size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
          title="巡检记录详情加载失败"
          showIcon
          type="error"
        />
      ) : null}
      {query.data ? (
        <Space className="inspection-detail-content" orientation="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions bordered column={{ xs: 1, sm: 2 }} size="small" title={query.data.item.roomName}>
            <Descriptions.Item label="巡检人">{query.data.item.createdByName}</Descriptions.Item>
            <Descriptions.Item label="提交时间">
              {formatDate(query.data.item.submittedAt || query.data.item.updatedAt)}
            </Descriptions.Item>
            <Descriptions.Item label="IACUC">{query.data.item.snapshot.iacucs.join("、") || "-"}</Descriptions.Item>
            <Descriptions.Item label="项目负责人">{query.data.item.snapshot.pis.join("、") || "-"}</Descriptions.Item>
            <Descriptions.Item label="品系">{query.data.item.snapshot.species.join("、") || "-"}</Descriptions.Item>
            <Descriptions.Item label="动物数量">{query.data.item.snapshot.animalCount}</Descriptions.Item>
          </Descriptions>
          <Card size="small" title="巡检结论概览">
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              {outcomeSummary.map((module) => (
                <Space key={module.code} wrap>
                  <Typography.Text strong>{MODULE_LABELS[module.code]}</Typography.Text>
                  <Tag>{module.items.length} 项标准</Tag>
                  <Tag color="green">正常 {module.counts.normal}</Tag>
                  <Tag color="red">异常 {module.counts.abnormal}</Tag>
                </Space>
              ))}
            </Space>
            {abnormalities.length ? (
              <Collapse
                items={[
                  {
                    key: "abnormalities",
                    label: `查看 ${abnormalities.length} 项异常登记`,
                    children: (
                      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                        {abnormalities.map((item) => (
                          <Space key={`${item.moduleCode}:${item.name}`} wrap>
                            <Tag>{MODULE_LABELS[item.moduleCode]}</Tag>
                            <Typography.Text>{item.name}</Typography.Text>
                            <Tag color="red">异常</Tag>
                          </Space>
                        ))}
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              <Alert title="本次巡检均已确认正常。" showIcon type="success" />
            )}
          </Card>
          <Card size="small" title="异常与处置">
            {query.data.findings.length ? (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                {query.data.findings.map((finding) => (
                  <div key={finding.nodeCode} className="inspection-finding-row">
                    <div>
                      <Typography.Text strong>{finding.nodeCode}</Typography.Text>
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                        {FINDING_STATUS_LABELS[finding.status]} · {finding.actionNote || "待补充处置措施"}
                      </Typography.Paragraph>
                    </div>
                    {finding.attachments.length ? <Tag>{finding.attachments.length} 张照片</Tag> : null}
                  </div>
                ))}
              </Space>
            ) : (
              <Empty description="本次巡检未生成异常处置项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Space>
      ) : null}
    </Modal>
  );
}
