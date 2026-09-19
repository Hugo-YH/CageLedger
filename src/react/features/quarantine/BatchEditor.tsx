import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { ListRefreshStatus } from "../../components/ui";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Collapse,
  DatePicker,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { speciesLabel } from "../../../domain/intake";
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
  const [draft, setDraft] = useState<QuarantineBatch>(() =>
    initial
      ? { ...initial, batchNo: initial.batchNo ?? initial.name, notes: initial.notes ?? "" }
      : {
          id: id(),
          batchNo: "",
          name: "",
          sources: initialSources,
          notes: "",
          conclusion: "",
          handling: "",
          updatedAt: "",
        },
  );
  const [dirty, setDirty] = useState(initialSources.length > 0);
  const [numberTouched, setNumberTouched] = useState(false);
  const [page, setPage] = useState(1);
  const sources = useQuarantineSources("", "", page, true);
  const businessDate =
    draft.sources
      .map((source) => source.intakeDate)
      .filter(Boolean)
      .sort()[0] ?? dayjs().format("YYYY-MM-DD");
  const nextNumber = useQuarantineQuery<{ batchNo: string }>(
    `batch-number?businessDate=${encodeURIComponent(businessDate)}`,
    !initial,
  );
  const suppliers = useQuarantineQuery<{ items: string[] }>("supplier-options");
  const write = useQuarantineWrite();
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState({
    supplier: "",
    species: "小鼠",
    pi: "",
    owner: "",
    notes: "哨兵鼠",
    intakeDate: "",
  });
  const seenIntakes = new Set<string>();
  const sourceRows = [
    ...(initial?.sources ?? [])
      .filter((source) => !source.manual && source.intakeId)
      .map((source) => ({ ...source, id: source.intakeId })),
    ...(sources.data?.items ?? []),
  ].filter((source) => {
    if (!source.id || seenIntakes.has(source.id)) return false;
    seenIntakes.add(source.id);
    return true;
  });
  useEffect(() => {
    if (!initial && !numberTouched && nextNumber.data?.batchNo) {
      setDraft((current) =>
        current.batchNo === nextNumber.data.batchNo
          ? current
          : { ...current, batchNo: nextNumber.data.batchNo, name: nextNumber.data.batchNo },
      );
    }
  }, [initial, nextNumber.data?.batchNo, numberTouched]);
  const confirmLeave = useUnsavedChanges(dirty, write.isPending);
  function updateDraft(value: QuarantineBatch) {
    setDraft(value);
    setDirty(true);
  }
  function updateManual(value: typeof manual) {
    setManual(value);
    setDirty(true);
  }
  function addManual() {
    if (!manual.supplier.trim() || !manual.species.trim()) {
      setError("手工来源请填写供应商和动物种类");
      return;
    }
    updateDraft({
      ...draft,
      sources: [...draft.sources, { ...manual, id: id(), intakeId: "", iacuc: "", batchNo: "", manual: true }],
    });
    setError("");
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setError("");
    try {
      await write.mutateAsync({
        path: initial ? `batches/${initial.id}` : "batches",
        method: initial ? "PUT" : "POST",
        body: { item: draft, expectedUpdatedAt: initial?.updatedAt },
      });
      onSaved(draft.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      saving.current = false;
    }
  }
  return (
    <Modal
      open
      title={initial ? "编辑检疫批次" : "新建检疫批次"}
      width={980}
      onCancel={() => {
        if (!saving.current)
          void confirmLeave().then((leave) => {
            if (leave) onClose();
          });
      }}
      onOk={() => void save()}
      confirmLoading={write.isPending}
      closable={!write.isPending}
      cancelButtonProps={{ disabled: write.isPending }}
      okButtonProps={{ "aria-label": "保存检疫批次" }}
      okText="保存检疫批次"
      className="quarantine-modal"
    >
      <div data-feature="quarantine">
        {error && <Alert type="error" title={error} showIcon />}
        <Form className="quarantine-batch-form" layout="vertical" disabled={write.isPending}>
          <Card size="small" title="批次登记" extra={<Tag>{draft.sources.length} 项已选来源</Tag>}>
            <Form.Item
              label="检疫批次编号"
              required
              extra={initial ? "批次编号首次保存后不可修改" : `默认按业务日期 ${businessDate} 生成，保存前可以修改`}
            >
              <Input
                aria-label="检疫批次编号"
                value={draft.batchNo}
                disabled={Boolean(initial)}
                placeholder="例如：B26090901"
                maxLength={initial ? undefined : 9}
                onChange={(e) => {
                  const batchNo = e.target.value.toUpperCase();
                  setNumberTouched(true);
                  updateDraft({ ...draft, batchNo, name: batchNo });
                }}
              />
            </Form.Item>
          </Card>
          <Card size="small" title="选择覆盖来源">
            <Typography.Paragraph type="secondary">
              将本次检疫覆盖的到货记录加入批次；实际抽样在检测记录中登记。
            </Typography.Paragraph>
            {sources.error && (
              <Alert
                type="error"
                title={sources.error.message}
                action={<Button onClick={() => void sources.refetch()}>重试</Button>}
              />
            )}
            <ListRefreshStatus active={sources.isFetching && !sources.isPending} />
            <Table
              size="small"
              rowKey="id"
              dataSource={sourceRows}
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
                { title: "种类", render: (_, row) => speciesLabel(row.species) || "—" },
                { title: "品系", render: (_, row) => row.strainStandard || row.strainRaw || "—" },
                { title: "数量", dataIndex: "quantity" },
                { title: "IACUC", dataIndex: "iacuc" },
                {
                  title: "覆盖",
                  render: (_, row) => {
                    const selected = draft.sources.some((source) => source.intakeId === row.id);
                    return selected ? (
                      <Space size={4}>
                        <Tag color="blue">已添加</Tag>
                        <Button
                          type="link"
                          danger
                          onClick={() =>
                            updateDraft({
                              ...draft,
                              sources: draft.sources.filter((source) => source.intakeId !== row.id),
                            })
                          }
                        >
                          移除
                        </Button>
                      </Space>
                    ) : (
                      <Button
                        onClick={() => {
                          const existing = initial?.sources.find((source) => source.intakeId === row.id);
                          updateDraft({
                            ...draft,
                            sources: [...draft.sources, existing ?? { ...row, id: id(), intakeId: row.id }],
                          });
                        }}
                      >
                        添加
                      </Button>
                    );
                  },
                },
              ]}
            />
            <Collapse
              size="small"
              items={[
                {
                  key: "manual-source",
                  label: "手工补充来源（哨兵鼠等）",
                  children: (
                    <>
                      <div className="quarantine-fields">
                        <Form.Item label="供应商">
                          <AutoComplete
                            aria-label="手工供应商"
                            value={manual.supplier}
                            options={[
                              ...new Set([...(suppliers.data?.items ?? []), ...draft.sources.map((s) => s.supplier)]),
                            ].map((value) => ({ value }))}
                            onChange={(supplier) => updateManual({ ...manual, supplier })}
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
                              onChange={(e) => updateManual({ ...manual, [key]: e.target.value })}
                            />
                          </Form.Item>
                        ))}
                        <Form.Item label="来源日期">
                          <DatePicker
                            aria-label="手工来源日期"
                            value={manual.intakeDate ? dayjs(manual.intakeDate) : null}
                            onChange={(v) => updateManual({ ...manual, intakeDate: v?.format("YYYY-MM-DD") ?? "" })}
                          />
                        </Form.Item>
                      </div>
                      <Button onClick={addManual}>添加手工来源</Button>
                      {draft.sources.some((source) => source.manual) && (
                        <>
                          <Typography.Title level={5}>已添加手工来源</Typography.Title>
                          <Space wrap>
                            {draft.sources
                              .filter((source) => source.manual)
                              .map((source) => (
                                <Tag
                                  key={source.id}
                                  closable={!write.isPending}
                                  onClose={() =>
                                    updateDraft({
                                      ...draft,
                                      sources: draft.sources.filter((value) => value.id !== source.id),
                                    })
                                  }
                                >
                                  {sourceLabel(source)}
                                </Tag>
                              ))}
                          </Space>
                        </>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </Card>
          <Card size="small" title="批次备注">
            <Form.Item label="备注">
              <Input.TextArea
                aria-label="检疫批次备注"
                value={draft.notes}
                placeholder="可填写本批次需要说明的信息"
                onChange={(e) => updateDraft({ ...draft, notes: e.target.value })}
              />
            </Form.Item>
          </Card>
        </Form>
      </div>
    </Modal>
  );
}
