import { useState } from "react";
import { Alert, AutoComplete, Button, DatePicker, Form, Input, Modal, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import type { QuarantineBatch, QuarantineSource } from "../../../contracts/quarantine";
import { useQuarantineSources, useQuarantineWrite, useQuarantineQuery } from "../../api/quarantine";
import { id, sourceLabel } from "./shared";

export function BatchEditor({
  initial,
  initialSources = [],
  onClose,
  onSaved,
}: {
  initial?: QuarantineBatch;
  initialSources?: QuarantineSource[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState<QuarantineBatch>(
    () => initial ?? { id: id(), name: "", sources: initialSources, conclusion: "", handling: "", updatedAt: "" },
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const sources = useQuarantineSources(from, to, page, true);
  const suppliers = useQuarantineQuery<{ items: string[] }>("supplier-options");
  const write = useQuarantineWrite();
  const [error, setError] = useState("");
  const [manual, setManual] = useState({
    supplier: "",
    species: "小鼠",
    pi: "",
    owner: "",
    notes: "哨兵鼠",
    intakeDate: "",
  });
  function addManual() {
    if (!manual.supplier.trim() || !manual.species.trim()) {
      setError("手工来源请填写供应商和动物种类");
      return;
    }
    setDraft({
      ...draft,
      sources: [...draft.sources, { ...manual, id: id(), intakeId: "", iacuc: "", batchNo: "", manual: true }],
    });
    setError("");
  }
  async function save() {
    try {
      await write.mutateAsync({
        path: initial ? `batches/${initial.id}` : "batches",
        method: initial ? "PUT" : "POST",
        body: { item: draft, expectedUpdatedAt: initial?.updatedAt },
      });
      onSaved(draft.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }
  return (
    <Modal
      open
      title={initial ? "编辑检疫批次" : "新建检疫批次"}
      width={980}
      onCancel={onClose}
      onOk={() => void save()}
      confirmLoading={write.isPending}
      okText="保存检疫批次"
      className="quarantine-modal"
    >
      <div data-feature="quarantine">
        {error && <Alert type="error" title={error} showIcon />}
        <Form layout="vertical">
          <Form.Item label="检疫批次名称" required>
            <Input
              aria-label="检疫批次名称"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Form.Item>
          <Typography.Title level={5}>待检疫动物（已接收、尚未加入检疫批次）</Typography.Title>
          <Space wrap>
            <DatePicker
              aria-label="到货起始日期"
              value={from ? dayjs(from) : null}
              onChange={(v) => {
                setFrom(v?.format("YYYY-MM-DD") ?? "");
                setPage(1);
              }}
            />
            <DatePicker
              aria-label="到货结束日期"
              value={to ? dayjs(to) : null}
              onChange={(v) => {
                setTo(v?.format("YYYY-MM-DD") ?? "");
                setPage(1);
              }}
            />
          </Space>
          {sources.error && <Alert type="error" title={sources.error.message} />}
          <Table
            size="small"
            rowKey="id"
            dataSource={sources.data?.items ?? []}
            loading={sources.isLoading}
            scroll={{ x: 650 }}
            pagination={{
              current: page,
              pageSize: 30,
              total: sources.data?.page.total,
              onChange: setPage,
              showSizeChanger: false,
            }}
            columns={[
              { title: "到货日期", dataIndex: "intakeDate" },
              { title: "供应商", dataIndex: "supplier" },
              { title: "课题组", dataIndex: "pi" },
              { title: "种类", dataIndex: "species" },
              { title: "品系", render: (_, row) => row.strainStandard || row.strainRaw || "—" },
              { title: "数量", dataIndex: "quantity" },
              { title: "IACUC", dataIndex: "iacuc" },
              {
                title: "覆盖",
                render: (_, row) => (
                  <Button
                    disabled={draft.sources.some((s) => s.intakeId === row.id)}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sources: [...draft.sources, { ...row, id: id(), intakeId: row.id }],
                      })
                    }
                  >
                    添加
                  </Button>
                ),
              },
            ]}
          />
          <Typography.Title level={5}>手工补充来源</Typography.Title>
          <div className="quarantine-fields">
            <Form.Item label="供应商">
              <AutoComplete
                aria-label="手工供应商"
                value={manual.supplier}
                options={[...new Set([...(suppliers.data?.items ?? []), ...draft.sources.map((s) => s.supplier)])].map(
                  (value) => ({ value }),
                )}
                onChange={(supplier) => setManual({ ...manual, supplier })}
              />
            </Form.Item>
            {(
              [
                ["species", "动物种类"],
                ["pi", "课题组"],
                ["owner", "联系人"],
                ["notes", "来源说明"],
              ] as const
            ).map(([key, label]) => (
              <Form.Item label={label} key={key}>
                <Input
                  aria-label={`手工${label}`}
                  value={manual[key]}
                  onChange={(e) => setManual({ ...manual, [key]: e.target.value })}
                />
              </Form.Item>
            ))}
            <Form.Item label="来源日期">
              <DatePicker
                aria-label="手工来源日期"
                value={manual.intakeDate ? dayjs(manual.intakeDate) : null}
                onChange={(v) => setManual({ ...manual, intakeDate: v?.format("YYYY-MM-DD") ?? "" })}
              />
            </Form.Item>
          </div>
          <Button onClick={addManual}>添加手工来源</Button>
          <Typography.Title level={5}>已选覆盖来源（{draft.sources.length}）</Typography.Title>
          <Space wrap>
            {draft.sources.map((s) => (
              <Tag
                key={s.id}
                closable
                onClose={() => setDraft({ ...draft, sources: draft.sources.filter((value) => value.id !== s.id) })}
              >
                {sourceLabel(s)}
              </Tag>
            ))}
          </Space>
          <Form.Item label="异常处理说明">
            <Input.TextArea
              aria-label="异常处理说明"
              value={draft.handling}
              onChange={(e) => setDraft({ ...draft, handling: e.target.value })}
            />
          </Form.Item>
          <Form.Item label="最终结论（人工填写）">
            <Input.TextArea
              aria-label="检疫最终结论"
              value={draft.conclusion}
              onChange={(e) => setDraft({ ...draft, conclusion: e.target.value })}
            />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}
