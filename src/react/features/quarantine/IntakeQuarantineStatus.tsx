import { useOperationFeedback } from "../../hooks/useOperationFeedback";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { useRef, useState } from "react";
import { Alert, Button, Select, Space, Tag } from "antd";
import { Modal } from "../../components/ui/Modal";
import type { IntakeBatchListItem } from "../../../contracts/intake";
import { downloadQuarantine, useQuarantineOverview } from "../../api/quarantine";
import { methodLabels, quarantineStatusColor } from "./shared";

export function IntakeQuarantineStatus({ item }: { item: IntakeBatchListItem }) {
  const feedback = useOperationFeedback();
  const [batchId, setBatchId] = useState("");
  const [error, setError] = useState("");
  const detail = useQuarantineOverview(batchId);
  const downloadLock = useRef(false);
  const [downloading, setDownloading] = useState("");
  const related = item.quarantineBatches ?? [];
  const quarantineStatus = item.quarantineStatus || (item.status === "received" ? "待检疫" : "待接收");
  async function download(reportId: string) {
    if (downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(reportId);
    setError("");
    try {
      const filename = await downloadQuarantine(`reports/${reportId}`);
      feedback.success("检疫报告已生成，下载已开始", filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "下载失败，请重试");
    } finally {
      downloadLock.current = false;
      setDownloading("");
    }
  }
  return (
    <>
      <Space orientation="vertical" size={0}>
        <Tag color={quarantineStatusColor(quarantineStatus)}>{quarantineStatus}</Tag>
        {related.length > 0 && (
          <Button
            icon={<ActionIcon name="info" />}
            size="small"
            type="link"
            onClick={() => {
              setError("");
              setBatchId(related[0].id);
            }}
          >
            检疫记录
          </Button>
        )}
      </Space>
      <Modal
        open={Boolean(batchId)}
        title="关联检疫记录与报告"
        footer={null}
        onCancel={() => {
          setBatchId("");
          setError("");
        }}
      >
        <div data-feature="quarantine">
          <Select
            aria-label="关联检疫批次"
            value={batchId}
            options={related.map((b) => ({ value: b.id, label: b.name }))}
            onChange={(id) => {
              setError("");
              setBatchId(id);
            }}
          />
          {(error || detail.error) && <Alert type="error" title={error || detail.error?.message} />}
          {detail.data && (
            <>
              <Tag>{detail.data.item.status}</Tag>
              <p>{detail.data.item.conclusion || "尚未填写最终结论"}</p>
              {detail.data.reports.map((report) => (
                <Button
                  block
                  className="quarantine-report-download"
                  key={report.id}
                  loading={downloading === report.id}
                  disabled={Boolean(downloading) && downloading !== report.id}
                  onClick={() => void download(report.id)}
                >
                  {methodLabels[report.method]} · {report.number} · v{report.version}
                </Button>
              ))}
              {!detail.data.reports.length && <p>尚未出具报告</p>}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
