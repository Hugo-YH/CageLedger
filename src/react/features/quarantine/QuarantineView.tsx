import {
  App,
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";

import { speciesLabel } from "../../../domain/intake";
import type {
  QuarantineBatch,
  QuarantineMethod,
  QuarantineTest,
  QuarantineSource,
} from "../../../contracts/quarantine";
import {
  useQuarantineBatches,
  useQuarantineCatalog,
  useQuarantineDetail,
  useQuarantineWrite,
} from "../../api/quarantine";
import { QuarantinePool } from "./QuarantinePool";
import { BatchCompletion } from "./BatchCompletion";
import { BatchEditor } from "./BatchEditor";
import { TestEditor } from "./TestEditor";
import { TestDetail } from "./TestDetail";
import { SupplierHistoryView } from "./SupplierHistory";
import { emptyTest, methodLabels } from "./shared";

export function QuarantineView({
  mode,
}: {
  mode: "quarantine-batches" | "quarantine-parasite" | "quarantine-elisa" | "quarantine-pcr" | "quarantine-reports";
}) {
  const { message, modal } = App.useApp();
  const isBatchManagement = mode === "quarantine-batches";
  const isReports = mode === "quarantine-reports";
  const [initialSources, setInitialSources] = useState<QuarantineSource[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [batchId, setBatchId] = useState("");
  const [batchEditor, setBatchEditor] = useState<QuarantineBatch | "new" | null>(null);
  const [editor, setEditor] = useState<QuarantineTest | null>(null);
  const [testId, setTestId] = useState("");
  const [tab, setTab] = useState(isBatchManagement ? "pool" : isReports ? "reports" : "batches");
  const [batchPicker, setBatchPicker] = useState(false);
  const [pendingNewRecord, setPendingNewRecord] = useState(false);
  const [method, setMethod] = useState<QuarantineMethod>(
    mode === "quarantine-parasite" ? "parasite" : mode === "quarantine-pcr" ? "pcr" : "elisa_mouse",
  );
  const batches = useQuarantineBatches(search, page);
  const detail = useQuarantineDetail(batchId);
  const catalog = useQuarantineCatalog();
  const tests =
    detail.data?.tests.filter(
      (t) =>
        isReports ||
        isBatchManagement ||
        (mode === "quarantine-elisa" ? t.method.startsWith("elisa") : t.method === method),
    ) ?? [];
  const selected = tests.find((t) => t.id === testId);
  function openBatch(value: string) {
    setBatchId(value);
    setTestId("");
    setEditor(null);
    if (isBatchManagement) setTab("batches");
    if (isReports) setTab("reports");
  }
  function startRecord(value: string) {
    openBatch(value);
    setBatchPicker(false);
    setPendingNewRecord(true);
  }
  useEffect(() => {
    if (!pendingNewRecord || !catalog.data || detail.data?.item.id !== batchId) return;
    setEditor(emptyTest(batchId, method, catalog.data.projects[method] ?? []));
    setPendingNewRecord(false);
  }, [batchId, catalog.data, detail.data, method, pendingNewRecord]);
  useEffect(() => {
    if (detail.error) setPendingNewRecord(false);
  }, [detail.error]);
  const title = isBatchManagement
    ? "检疫批次"
    : isReports
      ? "检疫报告"
      : mode === "quarantine-elisa"
        ? "ELISA检测"
        : methodLabels[method];
  const deleteBatch = useQuarantineWrite();

  function confirmDelete(batch: QuarantineBatch) {
    modal.confirm({
      title: "删除检疫批次",
      content: `确认删除“${batch.name}”吗？已有检测记录的批次不能删除。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteBatch.mutateAsync({
            path: `batches/${batch.id}`,
            method: "DELETE",
            body: { expectedUpdatedAt: batch.updatedAt },
          });
          if (batchId === batch.id) openBatch("");
          await message.success("检疫批次已删除");
        } catch (error) {
          await message.error(error instanceof Error ? error.message : "删除检疫批次失败");
          throw error;
        }
      },
    });
  }
  return (
    <section data-feature="quarantine" className={editor ? "quarantine-editing" : undefined} aria-label={title}>
      <Space wrap className="quarantine-page-heading">
        <Typography.Title level={3}>{title}</Typography.Title>
        {!isReports && (
          <Button
            type="primary"
            onClick={() => {
              if (isBatchManagement) {
                setInitialSources([]);
                setBatchEditor("new");
              } else {
                setBatchPicker(true);
              }
            }}
          >
            {isBatchManagement ? "新建检疫批次" : `新建${title}记录`}
          </Button>
        )}
      </Space>
      {(isBatchManagement || isReports) && (
        <Tabs
          className="quarantine-page-tabs"
          activeKey={tab}
          onChange={setTab}
          items={
            isBatchManagement
              ? [
                  { key: "pool", label: "待检疫列表" },
                  { key: "batches", label: "检疫批次列表" },
                ]
              : [
                  { key: "reports", label: "报告列表" },
                  { key: "suppliers", label: "供应商历史" },
                ]
          }
        />
      )}
      {isBatchManagement && tab === "pool" ? (
        <QuarantinePool
          onOpen={openBatch}
          onCreate={(sources) => {
            setInitialSources(sources);
            setBatchEditor("new");
          }}
        />
      ) : tab === "suppliers" ? (
        <SupplierHistoryView onOpen={openBatch} />
      ) : (
        <>
          {!editor && !batchId && (
            <Input.Search
              aria-label="搜索检疫批次"
              placeholder="按检疫批次编号搜索"
              allowClear
              onSearch={(v) => {
                setSearch(v);
                setPage(1);
              }}
            />
          )}
          {batches.error && <Alert type="error" title={batches.error.message} />}
          {!editor && !batchId && batches.isLoading ? (
            <div role="status" aria-label="正在加载检疫批次">
              <Skeleton active />
            </div>
          ) : !editor && !batchId ? (
            <Table
              rowKey="id"
              size="small"
              dataSource={batches.data?.items ?? []}
              scroll={{ x: 560 }}
              pagination={{
                current: page,
                pageSize: 30,
                total: batches.data?.page.total,
                onChange: setPage,
                showSizeChanger: false,
              }}
              columns={[
                { title: "检疫批次", dataIndex: "name" },
                { title: "覆盖来源", render: (_, b) => b.sources.length },
                { title: "检疫状态", render: (_, b) => (b.completedAt ? "已检疫" : "检疫中") },
                { title: "最终结论", dataIndex: "conclusion" },
                {
                  title: "操作",
                  width: isBatchManagement ? 210 : 130,
                  render: (_, b) => (
                    <Space size={4} wrap>
                      <Button type={b.id === batchId ? "primary" : "default"} onClick={() => openBatch(b.id)}>
                        {isBatchManagement ? "查看" : isReports ? "查看报告" : "查看检测记录"}
                      </Button>
                      {isBatchManagement && (
                        <>
                          <Button disabled={Boolean(b.completedAt)} onClick={() => setBatchEditor(b)}>
                            编辑
                          </Button>
                          <Button danger disabled={deleteBatch.isPending} onClick={() => confirmDelete(b)}>
                            删除
                          </Button>
                        </>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          ) : null}
          {detail.error && <Alert type="error" title={detail.error.message} />}
          {batchId && detail.isLoading && <Skeleton active />}
          {detail.data && (
            <>
              {!editor && (
                <Card
                  title={detail.data.item.name}
                  extra={
                    <Space wrap>
                      <Button onClick={() => openBatch("")}>返回列表</Button>
                      {isBatchManagement && (
                        <Button
                          disabled={Boolean(detail.data.item.completedAt)}
                          onClick={() => setBatchEditor(detail.data.item)}
                        >
                          编辑检疫批次
                        </Button>
                      )}
                    </Space>
                  }
                >
                  <Space wrap>
                    <Tag>{detail.data.item.status}</Tag>
                    <span>{detail.data.item.conclusion || "尚未填写最终结论"}</span>
                  </Space>
                  {detail.data.item.handling && <p>处理说明：{detail.data.item.handling}</p>}
                  {detail.data.item.notes && <p>备注：{detail.data.item.notes}</p>}
                  <Space wrap>
                    {detail.data.item.sources.map((s) => (
                      <Tag key={s.id}>
                        {s.supplier} · {s.strainStandard || s.strainRaw || speciesLabel(s.species)} · {s.pi}
                        {s.manual ? " · 手工来源" : ""}
                      </Tag>
                    ))}
                  </Space>
                </Card>
              )}
              {isBatchManagement && !editor && <BatchCompletion detail={detail.data} />}
              {!isReports && !isBatchManagement && !editor && !detail.data.item.completedAt && (
                <Space wrap>
                  {mode === "quarantine-elisa" && (
                    <Select
                      aria-label="ELISA动物种类"
                      value={method}
                      options={[
                        { value: "elisa_mouse", label: "小鼠" },
                        { value: "elisa_rat", label: "大鼠" },
                      ]}
                      onChange={setMethod}
                    />
                  )}
                  <Button
                    type="primary"
                    disabled={!catalog.data}
                    onClick={() => setEditor(emptyTest(batchId, method, catalog.data?.projects[method] ?? []))}
                  >
                    新建检测记录
                  </Button>
                </Space>
              )}
              {!isBatchManagement && (
                <>
                  {catalog.error && <Alert type="error" title={catalog.error.message} />}
                  {!editor && (
                    <Space wrap>
                      {tests.map((t) => (
                        <Button
                          key={t.id}
                          type={testId === t.id ? "primary" : "default"}
                          onClick={() => {
                            setTestId(t.id);
                            setEditor(null);
                          }}
                        >
                          {methodLabels[t.method]} · {t.testDate || "日期未填"} ·{" "}
                          {t.state === "issued" ? "已出具" : "草稿"}
                          {t.retestOf ? " · 复检" : ""}
                          {t.correctionOf ? " · 更正" : ""}
                        </Button>
                      ))}
                    </Space>
                  )}
                  {editor ? (
                    <TestEditor
                      key={editor.id}
                      initial={editor}
                      detail={detail.data}
                      batch={detail.data.item}
                      onCancel={() => setEditor(null)}
                    />
                  ) : selected ? (
                    <TestDetail
                      key={selected.id}
                      test={selected}
                      detail={detail.data}
                      onEdit={() => setEditor(selected)}
                      onCreated={(value) => {
                        setTestId(value);
                      }}
                    />
                  ) : (
                    <Empty
                      description={tests.length ? "选择检测记录查看内容和报告" : "暂无检测记录，请在对应检测页面录入"}
                    />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      {batchEditor && (
        <BatchEditor
          initialSources={initialSources}
          initial={batchEditor === "new" ? undefined : batchEditor}
          onClose={() => {
            setBatchEditor(null);
            setPendingNewRecord(false);
          }}
          onSaved={(value) => {
            setBatchEditor(null);
            if (pendingNewRecord) startRecord(value);
            else openBatch(value);
          }}
        />
      )}
      <Modal
        open={batchPicker}
        title={`新建${title}记录`}
        width={860}
        footer={null}
        onCancel={() => setBatchPicker(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          选择本次检测所属的检疫批次，随后直接进入已确认的五部分检测记录填写界面。
        </Typography.Paragraph>
        <Space wrap>
          {mode === "quarantine-elisa" && (
            <Select
              aria-label="ELISA动物种类"
              value={method}
              options={[
                { value: "elisa_mouse", label: "小鼠" },
                { value: "elisa_rat", label: "大鼠" },
              ]}
              onChange={setMethod}
            />
          )}
          <Input.Search
            aria-label="搜索待填写检疫批次"
            placeholder="按检疫批次编号搜索"
            allowClear
            onSearch={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
        </Space>
        {batches.error && <Alert type="error" title={batches.error.message} />}
        <Table<QuarantineBatch>
          rowKey="id"
          size="small"
          loading={batches.isLoading}
          dataSource={batches.data?.items ?? []}
          scroll={{ x: 620 }}
          pagination={{
            current: page,
            pageSize: 30,
            total: batches.data?.page.total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: "检疫批次", dataIndex: "name" },
            { title: "覆盖来源", render: (_, batch) => batch.sources.length },
            { title: "状态", render: (_, batch) => (batch.completedAt ? "已检疫" : "检疫中") },
            {
              title: "操作",
              width: 120,
              render: (_, batch) => (
                <Button type="primary" disabled={Boolean(batch.completedAt)} onClick={() => startRecord(batch.id)}>
                  选择并填写
                </Button>
              ),
            },
          ]}
        />
        <Button
          onClick={() => {
            setBatchPicker(false);
            setInitialSources([]);
            setPendingNewRecord(true);
            setBatchEditor("new");
          }}
        >
          没有合适批次，新建检疫批次
        </Button>
      </Modal>
    </section>
  );
}
