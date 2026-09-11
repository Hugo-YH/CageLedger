import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Image, Input, InputNumber, Modal, Select, Space, Typography, Upload } from "antd";
import type { QuarantineAttachment, QuarantineTest } from "../../../contracts/quarantine";
import { downloadQuarantine, useQuarantineAttachmentWrite } from "../../api/quarantine";

type Props = {
  test: QuarantineTest;
  attachments: QuarantineAttachment[];
  persist?: () => Promise<QuarantineTest>;
  onVersion?: (t: QuarantineTest) => void;
  busy?: boolean;
  onBusy?: (busy: boolean) => void;
};
export function RecordAttachments({ test, attachments, persist, onVersion, busy, onBusy }: Props) {
  const write = useQuarantineAttachmentWrite();
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [sampleId, setSampleId] = useState(test.samples[0]?.id ?? "");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [category, setCategory] = useState(test.method === "parasite" ? "体外" : "原始记录");
  useEffect(() => {
    if (test.method === "parasite" && !test.samples.some((sample) => sample.id === sampleId)) {
      setSampleId(test.samples[0]?.id ?? "");
    }
  }, [sampleId, test.method, test.samples]);
  async function upload(file: File) {
    if (!persist || lock.current) return;
    lock.current = true;
    onBusy?.(true);
    setError("");
    try {
      const current = await persist();
      const res = await write.mutateAsync({
        path: `tests/${test.id}/attachments?${new URLSearchParams({ sampleId: test.method === "parasite" ? sampleId : "", projectIds: JSON.stringify(projectIds), category, expectedUpdatedAt: current.updatedAt })}`,
        file,
      });
      onVersion?.(res.test);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      lock.current = false;
      onBusy?.(false);
    }
  }
  const items = attachments
    .filter((a) => a.testId === test.id && !a.removed)
    .sort(
      (a, b) =>
        (a.position ?? 0) - (b.position ?? 0) ||
        (a.uploadedAt ?? a.updatedAt).localeCompare(b.uploadedAt ?? b.updatedAt) ||
        a.id.localeCompare(b.id),
    );
  return (
    <>
      {error && <Alert type="error" title={error} />}
      {persist && (
        <Space wrap>
          {test.method === "parasite" && (
            <>
              <Select
                aria-label="附件样本"
                value={sampleId || undefined}
                placeholder="选择样本"
                options={test.samples.map((s) => ({ value: s.id, label: `样本 ${s.number}` }))}
                onChange={setSampleId}
              />
              <Select
                aria-label="附件分类"
                value={category}
                options={["体内", "体外"].map((value) => ({ value, label: value }))}
                onChange={setCategory}
              />
            </>
          )}
          <Select
            mode="multiple"
            aria-label="附件检测项目"
            placeholder="图中检测项目（可多选）"
            value={projectIds}
            options={test.projects.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setProjectIds}
          />
          <Upload
            accept=".png,.jpg,.jpeg,.tif,.tiff,.pdf,.xlsx,.xls"
            showUploadList={false}
            beforeUpload={(file) => {
              void upload(file);
              return false;
            }}
          >
            <Button
              disabled={
                busy || write.isPending || (test.method === "parasite" && !test.samples.some((s) => s.id === sampleId))
              }
              loading={write.isPending}
            >
              上传原始资料
            </Button>
          </Upload>
          <Typography.Text type="secondary">上传时保存当前草稿；图片可关联多个项目。</Typography.Text>
        </Space>
      )}
      {!items.length && (
        <div className="quarantine-record-empty">尚未上传原始记录。图片将自动排列，PDF、Excel 作为附件留档。</div>
      )}
      <div className="quarantine-record-images">
        {items.map((attachment) => (
          <AttachmentCard
            key={`${attachment.id}-${attachment.updatedAt}`}
            attachment={attachment}
            test={test}
            persist={persist}
            onVersion={onVersion}
            busy={busy}
            onBusy={onBusy}
          />
        ))}
      </div>
    </>
  );
}
function AttachmentCard({
  attachment: a,
  test,
  persist,
  onVersion,
  busy,
  onBusy,
}: Omit<Props, "attachments"> & { attachment: QuarantineAttachment }) {
  const [draft, setDraft] = useState(a);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState(false);
  const write = useQuarantineAttachmentWrite();
  async function save(removed = false) {
    onBusy?.(true);
    try {
      setError("");
      const current = await persist!();
      const res = await write.mutateAsync({
        path: `attachments/${a.id}`,
        body: { expectedUpdatedAt: current.updatedAt, item: { ...draft, removed } },
      });
      onVersion?.(res.test);
      setRemove(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      onBusy?.(false);
    }
  }
  const projectIds = draft.projectIds ?? (draft.projectId ? [draft.projectId] : []);
  return (
    <Card size="small" title={a.name} className="quarantine-attachment-card">
      {error && <Alert type="error" title={error} />}
      {a.mime.startsWith("image/") ? (
        <Image
          className="quarantine-record-image"
          src={`/api/quarantine/attachments/${a.id}?preview=1`}
          alt={draft.caption || a.name}
        />
      ) : (
        <Button
          type="link"
          onClick={() => {
            void downloadQuarantine(`attachments/${a.id}`).catch((e: Error) => setError(e.message));
          }}
        >
          下载 {a.name}
        </Button>
      )}
      {persist ? (
        <div className="quarantine-record-image-fields">
          <Select
            mode="multiple"
            aria-label={`${a.name} 检测项目`}
            value={projectIds}
            options={test.projects.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(projectIds) => setDraft({ ...draft, projectIds })}
          />
          {test.method === "parasite" && (
            <Space wrap>
              <Select
                aria-label={`${a.name} 样本`}
                value={draft.sampleId}
                options={test.samples.map((s) => ({ value: s.id, label: s.number }))}
                onChange={(sampleId) => setDraft({ ...draft, sampleId })}
              />
              <Select
                aria-label={`${a.name} 分类`}
                value={draft.category}
                options={["体内", "体外", "原始记录"].map((value) => ({ value, label: value }))}
                onChange={(category) => setDraft({ ...draft, category })}
              />
            </Space>
          )}
          <Input.TextArea
            aria-label={`${a.name} 图注`}
            placeholder="图注或实验说明"
            value={draft.caption ?? ""}
            onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
          />
          <label htmlFor={`attachment-position-${a.id}`}>
            排列顺序（小号在前）
            <InputNumber
              id={`attachment-position-${a.id}`}
              aria-label={`${a.name} 排列顺序`}
              min={0}
              max={100000}
              precision={0}
              value={draft.position ?? 0}
              onChange={(position) => setDraft({ ...draft, position: position ?? 0 })}
            />
          </label>
          <Space wrap>
            <Button disabled={busy || write.isPending} onClick={() => void save()} loading={write.isPending}>
              保存图片信息
            </Button>
            <Button danger disabled={busy || write.isPending} onClick={() => setRemove(true)}>
              移除附件
            </Button>
          </Space>
        </div>
      ) : (
        <>
          <p>
            {test.projects
              .filter((p) => projectIds.includes(p.id))
              .map((p) => p.name)
              .join("、")}
          </p>
          <p>
            {a.category} {test.samples.find((s) => s.id === a.sampleId)?.number} {a.caption}
          </p>
        </>
      )}
      <Typography.Paragraph type="secondary">
        上传人：{a.uploadedBy.name} · {a.uploadedAt ?? a.updatedAt}
      </Typography.Paragraph>
      <Modal
        open={remove}
        title="从当前草稿移除此附件？"
        onCancel={() => setRemove(false)}
        onOk={() => void save(true)}
        confirmLoading={write.isPending}
        okText="移除附件"
      >
        <p>已出具的历史报告和原始上传记录仍会保留。</p>
        {error && <Alert type="error" title={error} />}
      </Modal>
    </Card>
  );
}
