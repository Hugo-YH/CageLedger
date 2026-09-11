import { useState } from "react";
import { Alert, Button, Modal, Space } from "antd";
import type { QuarantineDetail } from "../../../contracts/quarantine";
import { useQuarantineWrite } from "../../api/quarantine";

export function BatchCompletion({ detail }: { detail: QuarantineDetail }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const write = useQuarantineWrite();
  const reasons = detail.completionReasons;
  async function complete() {
    try {
      await write.mutateAsync({
        path: `batches/${detail.item.id}/complete`,
        body: {
          expectedUpdatedAt: detail.item.updatedAt,
          expectedTestVersions: Object.fromEntries(detail.tests.map((t) => [t.id, t.updatedAt])),
        },
      });
      setOpen(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败");
    }
  }
  if (detail.item.completedAt)
    return (
      <Alert
        type="success"
        title={`整批已检疫 · 确认人：${detail.item.completedBy?.name ?? ""}`}
        description={`覆盖的 ${detail.item.sources.length} 个来源统一关联本批次报告，包括未直接采样的动物。`}
      />
    );
  return (
    <Space orientation="vertical">
      <Alert type="info" title={reasons.length ? reasons.join("；") : "三类检测已完成，可以确认整批检疫完成"} />
      <Button type="primary" disabled={Boolean(reasons.length)} onClick={() => setOpen(true)}>
        确认检疫完成
      </Button>
      <Modal
        open={open}
        title="确认整批检疫完成"
        onCancel={() => setOpen(false)}
        onOk={() => void complete()}
        confirmLoading={write.isPending}
        okText="确认整批已检疫"
      >
        <p>
          将本批次覆盖的 {detail.item.sources.length}{" "}
          个来源统一标记为已检疫，并关联已出具的报告。未直接采样的动物同样属于本次检疫覆盖范围。
        </p>
        <p>最终结论：{detail.item.conclusion}</p>
        {error && <Alert type="error" title={error} />}
      </Modal>
    </Space>
  );
}
