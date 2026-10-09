import { useRef, useState } from "react";
import { Alert, Button, Form, Modal, Radio, Typography } from "antd";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { downloadQuarantine } from "../../api/quarantine";

export function BatchReportExport({ batchId, disabled }: { batchId: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("quarantine");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const lock = useRef(false);
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setLoading(true);
    setError("");
    setStatus("正在生成汇总 PDF…");
    try {
      const filename = await downloadQuarantine(`batches/${batchId}/summary?kind=${kind}`);
      setStatus(`已下载 ${filename}`);
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : "汇总报告下载失败");
    } finally {
      lock.current = false;
      setLoading(false);
    }
  }
  return (
    <>
      <Button icon={<ActionIcon name="download" />} disabled={disabled} onClick={() => setOpen(true)}>
        下载汇总PDF
      </Button>
      <Modal
        title="导出检测汇总报告"
        rootClassName="app-modal-root"
        open={open}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="close" onClick={() => setOpen(false)}>
            关闭
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<ActionIcon name="download" />}
            loading={loading}
            onClick={() => void download()}
          >
            下载汇总PDF
          </Button>,
        ]}
      >
        <Form layout="vertical">
          <Form.Item label="报告标题">
            <Radio.Group
              aria-label="报告标题"
              value={kind}
              disabled={loading}
              onChange={(event) => {
                setKind(event.target.value === "self" ? "self" : "quarantine");
                setStatus("");
                setError("");
              }}
              options={[
                { value: "quarantine", label: "实验动物检疫检测报告" },
                { value: "self", label: "实验动物自检检测报告" },
              ]}
            />
          </Form.Item>
        </Form>
        <Typography.Paragraph>
          按旧报告的项目分组汇总当前批次。更正替代原记录，复检单独列明；标题选择不会筛除批次中的动物来源。
          结果按阳性实验组数/已检测实验组数显示，不折算混样动物数。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          含未出具记录时标为汇总草稿；已出具记录读取冻结快照。签名栏留空，已有报告原件保留。
        </Typography.Paragraph>
        {error && <Alert type="error" title={error} />}
        <Typography.Paragraph role="status" aria-live="polite">
          {status}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
