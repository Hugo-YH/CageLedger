import { useState } from "react";
import { Alert, Button, Modal, Select, Space, Tag } from "antd";
import type { IntakeBatch } from "../../../contracts/intake";
import { downloadQuarantine, useQuarantineDetail } from "../../api/quarantine";
import { methodLabels } from "./shared";

export function IntakeQuarantineStatus({ item }: { item: IntakeBatch }) {
  const [batchId, setBatchId] = useState("");
  const [error, setError] = useState("");
  const detail = useQuarantineDetail(batchId);
  const related = item.quarantineBatches ?? [];
  return (
    <>
      <Space orientation="vertical" size={0}>
        <Tag>{item.quarantineStatus || (item.status === "received" ? "待检疫" : "待接收")}</Tag>
        {related.length > 0 && (
          <Button size="small" type="link" onClick={() => setBatchId(related[0].id)}>
            检疫记录
          </Button>
        )}
      </Space>
      <Modal open={Boolean(batchId)} title="关联检疫记录与报告" footer={null} onCancel={() => setBatchId("")}>
        <div data-feature="quarantine">
          <Select
            aria-label="关联检疫批次"
            value={batchId}
            options={related.map((b) => ({ value: b.id, label: b.name }))}
            onChange={setBatchId}
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
                  onClick={() => {
                    void downloadQuarantine(`reports/${report.id}`).catch((e: Error) => setError(e.message));
                  }}
                >
                  {methodLabels[detail.data.tests.find((t) => t.id === report.testId)!.method]} · {report.number} · v
                  {report.version}
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
