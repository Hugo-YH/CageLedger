import { useRef, useState } from "react";
import { Alert, Button, Card, Form, Modal, Select, Space, Tag, Typography } from "antd";
import type { QuarantineDetail, QuarantineTest } from "../../../contracts/quarantine";
import { downloadQuarantine, useQuarantineWrite } from "../../api/quarantine";
import { id, methodLabels } from "./shared";
import { ReportInformation, ReportProjects, ReportSamples } from "./ReportFields";
import { ReportResults } from "./ReportResults";
import { RecordAttachments } from "./RecordAttachments";
import { reportSections } from "./shared";
import { CommandBar } from "../../components/ui";
export function TestDetail({
  test,
  detail,
  onEdit,
  onCreated,
}: {
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
  const sections = reportSections(test.method);
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
    setDownloadStatus(path.endsWith("/preview") ? "正在生成 Word 草稿…" : "正在下载报告…");
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
      <Typography.Text role="status" aria-live="polite">
        {downloadStatus}
      </Typography.Text>
      <CommandBar
        ariaLabel="报告操作"
        actions={
          test.state === "draft" && (
            <>
              <Button onClick={onEdit}>编辑检测</Button>
              <Button
                aria-label="下载Word草稿"
                loading={Boolean(downloading)}
                onClick={() => void download(`tests/${test.id}/preview`)}
              >
                下载Word草稿
              </Button>
            </>
          )
        }
        primaryAction={
          test.state === "draft" ? (
            <Button type="primary" onClick={() => setIssuing(true)}>
              出具报告
            </Button>
          ) : (
            <Button type="primary" loading={write.isPending} onClick={() => void action("correction")}>
              创建更正草稿
            </Button>
          )
        }
      />
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
        <Button disabled={!supplier} loading={write.isPending} onClick={() => void action("retest")}>
          按供应商新建复检
        </Button>
      </Form>
      <div className="quarantine-report-form">
        <ReportInformation test={test} />
        {test.method !== "parasite" && (
          <section className="quarantine-report-section">
            <Typography.Title level={5}>
              {test.method === "pcr" ? "2、试剂盒名称" : "2、试剂盒名称及批号"}
            </Typography.Title>
            <ReportProjects
              test={test}
              batch={detail.item}
              fields={test.method === "pcr" ? ["name", "kit"] : undefined}
            />
            {test.method === "pcr" && (
              <>
                <Typography.Title level={5}>3、试剂盒批号</Typography.Title>
                <ReportProjects test={test} batch={detail.item} fields={["name", "lot"]} />
              </>
            )}
          </section>
        )}
        <section className="quarantine-report-section">
          <Typography.Title level={5}>{sections.sample}、样本统计表</Typography.Title>
          <ReportSamples test={test} batch={detail.item} />
        </section>
        <section className="quarantine-report-section">
          <Typography.Title level={5}>
            {sections.pictures}、
            {test.method === "parasite"
              ? "显微观察记录"
              : test.method === "pcr"
                ? "凝胶成像分析系统原始记录"
                : "原始记录"}
          </Typography.Title>
          <RecordAttachments test={test} attachments={detail.attachments} />
          {test.state === "draft" && <Button onClick={onEdit}>上传原始资料</Button>}
        </section>
        <ReportResults test={test} sectionNumber={sections.results} />
        <div className="quarantine-signatures">
          <span>检测人：____________</span>
          <span>复核人：____________</span>
          <span>日期：____________</span>
        </div>
        {test.reportFormVersion !== 2 && test.conclusion && (
          <Typography.Paragraph type="secondary">历史记录结论：{test.conclusion}</Typography.Paragraph>
        )}
      </div>
      {reports.length > 0 && (
        <Card size="small" title="已出具报告版本">
          <Space wrap>
            {reports.map((r) => (
              <Button
                key={r.id}
                loading={downloading === `reports/${r.id}`}
                disabled={Boolean(downloading) && downloading !== `reports/${r.id}`}
                onClick={() => void download(`reports/${r.id}`)}
              >
                {r.number} · 第{r.version}版 · {r.issuedBy.name}
              </Button>
            ))}
          </Space>
        </Card>
      )}
      <Modal
        open={issuing}
        title="确认出具检疫报告"
        onCancel={() => setIssuing(false)}
        onOk={() => void action("issue")}
        confirmLoading={write.isPending}
        okText="确认出具"
      >
        <p>将保存当前内容快照和Word文件。阳性、可疑结果可如实出具；签名栏留空供线下签字。</p>
        {error && <Alert type="error" title={error} />}
      </Modal>
    </Card>
  );
}
