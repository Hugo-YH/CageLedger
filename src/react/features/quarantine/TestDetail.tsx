import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Card, Collapse, Empty, Form, Modal, Select, Space, Tabs, Tag, Typography } from "antd";
import type { QuarantineDetail, QuarantineTest } from "../../../contracts/quarantine";
import { downloadQuarantine, useQuarantineWrite } from "../../api/quarantine";
import { id, methodLabels } from "./shared";
import { ReportInformation, ReportProjects, ReportSamples } from "./ReportFields";
import { ReportResults } from "./ReportResults";
import { RecordAttachments } from "./RecordAttachments";
import { BatchActivity } from "./BatchOverview";
export function TestDetail({
  test,
  detail,
  onEdit,
  onCreated,
  actionsContainer,
  primaryContainer,
  showReports = false,
}: {
  showReports?: boolean;
  actionsContainer: HTMLDivElement | null;
  primaryContainer: HTMLDivElement | null;
  test: QuarantineTest;
  detail: QuarantineDetail;
  onEdit: () => void;
  onCreated: (id: string) => void;
}) {
  const write = useQuarantineWrite();
  const [error, setError] = useState("");
  const [supplier, setSupplier] = useState<string>();
  const [issuing, setIssuing] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [failedDownload, setFailedDownload] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const downloadLock = useRef(false);

  const reports = detail.reports.filter((report) => report.testId === test.id);
  async function action(name: string) {
    setError("");
    setFailedDownload("");
    try {
      const response = await write.mutateAsync({
        path: `tests/${test.id}/${name}`,
        body: { id: id(), supplier, expectedUpdatedAt: test.updatedAt, expectedBatchUpdatedAt: detail.item.updatedAt },
      });
      setError("");
      setIssuing(false);
      if (name !== "issue") onCreated(response.item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  }
  async function download(path: string) {
    if (downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(path);
    setFailedDownload("");
    setError("");
    setDownloadStatus(path.endsWith("/preview") ? "正在生成 PDF 草稿…" : "正在下载报告…");
    try {
      const filename = await downloadQuarantine(path);
      setDownloadStatus(`已下载 ${filename}`);
    } catch (e) {
      setDownloadStatus("");
      setFailedDownload(path);
      setError(e instanceof Error ? e.message : "下载失败");
    } finally {
      downloadLock.current = false;
      setDownloading("");
    }
  }
  return (
    <Card
      className="quarantine-test-detail"
      title={
        <Space wrap>
          {methodLabels[test.method]}
          <Tag>{test.state === "issued" ? "已出具" : "草稿"}</Tag>
          {test.retestOf && <Tag>复检</Tag>}
          {test.correctionOf && <Tag>更正版本</Tag>}
        </Space>
      }
    >
      {error && (
        <Alert
          type="error"
          title={error}
          action={failedDownload && <Button onClick={() => void download(failedDownload)}>重试下载</Button>}
        />
      )}
      {downloadStatus && (
        <Typography.Text role="status" aria-live="polite">
          {downloadStatus}
        </Typography.Text>
      )}
      {actionsContainer &&
        createPortal(
          test.state === "draft" ? (
            <Space size={8} wrap>
              <Button onClick={onEdit}>编辑检测</Button>
              <Button
                aria-label="下载PDF草稿"
                loading={Boolean(downloading)}
                onClick={() => void download(`tests/${test.id}/preview`)}
              >
                下载PDF草稿
              </Button>
            </Space>
          ) : reports.length > 0 ? (
            <Button
              loading={Boolean(downloading)}
              onClick={() =>
                void download(
                  `reports/${reports.reduce((latest, report) => (report.version > latest.version ? report : latest)).id}`,
                )
              }
            >
              下载PDF报告
            </Button>
          ) : null,
          actionsContainer,
        )}
      {primaryContainer &&
        createPortal(
          test.state === "draft" ? (
            <Button type="primary" onClick={() => setIssuing(true)}>
              出具报告
            </Button>
          ) : (
            <Button type="primary" loading={write.isPending} onClick={() => void action("correction")}>
              创建更正草稿
            </Button>
          ),
          primaryContainer,
        )}
      <Tabs
        defaultActiveKey={showReports ? "reports" : "overview"}
        aria-label="检测记录内容"
        items={[
          {
            key: "overview",
            label: "记录概览",
            children: (
              <>
                <Space wrap>
                  <Tag>{test.samples.length} 个实验组</Tag>
                  <Tag>{test.projects.length} 个检测项目</Tag>
                  <Tag>
                    {detail.attachments.filter((attachment) => attachment.testId === test.id).length} 份原始资料
                  </Tag>
                </Space>
                <ReportInformation test={test} />
                {test.conclusion && <Typography.Paragraph>记录结论：{test.conclusion}</Typography.Paragraph>}
                {test.notes && <Typography.Paragraph>记录备注：{test.notes}</Typography.Paragraph>}
                <Alert
                  type={test.state === "issued" ? "success" : "info"}
                  showIcon
                  title={
                    test.state === "issued"
                      ? "已出具并冻结，可下载报告或创建更正草稿"
                      : "草稿可编辑，出具后冻结当前数据和原始资料"
                  }
                />
                <Collapse
                  items={[
                    {
                      key: "retest",
                      label: "复检与版本关联",
                      children: (
                        <>
                          {test.retestOf && <Button onClick={() => onCreated(test.retestOf)}>查看原始检测记录</Button>}
                          {test.correctionOf && (
                            <Button onClick={() => onCreated(test.correctionOf)}>查看更正前记录</Button>
                          )}
                          <Form className="quarantine-retest-actions" layout="vertical" aria-label="复检操作">
                            <Form.Item label="复检供应商">
                              <Select
                                aria-label="复检供应商"
                                placeholder="选择复检供应商"
                                value={supplier}
                                options={[
                                  ...new Set(
                                    test.samples
                                      .flatMap((s) => s.sourceIds)
                                      .map((sid) => detail.item.sources.find((s) => s.id === sid)?.supplier)
                                      .filter((s): s is string => Boolean(s)),
                                  ),
                                ].map((value) => ({ value, label: value }))}
                                onChange={setSupplier}
                              />
                            </Form.Item>
                            <Button
                              disabled={!supplier}
                              loading={write.isPending}
                              onClick={() => void action("retest")}
                            >
                              按供应商新建复检
                            </Button>
                          </Form>
                        </>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          { key: "samples", label: "样本清单", children: <ReportSamples test={test} batch={detail.item} /> },
          {
            key: "results",
            label: "项目与结果",
            children: (
              <>
                <ReportProjects test={test} batch={detail.item} />
                <ReportResults test={test} sectionNumber={1} />
              </>
            ),
          },
          {
            key: "attachments",
            label: "原始资料",
            children: (
              <>
                <RecordAttachments test={test} attachments={detail.attachments} />
                {test.state === "draft" && <Button onClick={onEdit}>上传原始资料</Button>}
              </>
            ),
          },
          {
            key: "reports",
            label: `报告版本（${reports.length}）`,
            children: reports.length ? (
              <Space orientation="vertical" className="quarantine-full-width">
                <Typography.Text strong>已出具报告版本</Typography.Text>
                {reports.map((report) => (
                  <Card size="small" key={report.id}>
                    <Space wrap>
                      <Typography.Text strong>
                        {report.number} · 第{report.version}版
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {report.issuedBy.name} · {report.updatedAt.replace("T", " ").slice(0, 19)}
                      </Typography.Text>
                      <Button
                        loading={downloading === `reports/${report.id}`}
                        disabled={Boolean(downloading) && downloading !== `reports/${report.id}`}
                        onClick={() => void download(`reports/${report.id}`)}
                      >
                        下载此版 PDF
                      </Button>
                    </Space>
                  </Card>
                ))}
              </Space>
            ) : (
              <Empty description="尚未出具报告，可先下载 PDF 草稿核对" />
            ),
          },
          { key: "activity", label: "操作历史", children: <BatchActivity batchId={detail.item.id} /> },
        ]}
      />
      <Modal
        open={issuing}
        title="确认出具检疫报告"
        onCancel={() => {
          if (!write.isPending) setIssuing(false);
        }}
        cancelButtonProps={{ disabled: write.isPending }}
        closable={!write.isPending}
        onOk={() => void action("issue")}
        confirmLoading={write.isPending}
        okText="确认出具"
      >
        <p>将保存当前内容快照和PDF文件。阳性、可疑结果可如实出具；签名栏留空供线下签字。</p>
        {error && <Alert type="error" title={error} />}
      </Modal>
    </Card>
  );
}
