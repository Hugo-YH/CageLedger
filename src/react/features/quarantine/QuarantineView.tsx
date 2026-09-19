import { RecordWorklist } from "./RecordWorklist";
import { BatchOverview } from "./BatchOverview";
import { App, Alert, Button, Empty, Input, Modal, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

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
import { PageSkeleton } from "../../components/PageSkeleton";
import { CommandBar, ListRefreshStatus } from "../../components/ui";

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
  const [batchState, setBatchState] = useState("");
  const [batchId, setBatchId] = useState("");
  const [batchEditor, setBatchEditor] = useState<QuarantineBatch | "new" | null>(null);
  const [editor, setEditor] = useState<QuarantineTest | null>(null);
  const [testId, setTestId] = useState("");
  const [recordActions, setRecordActions] = useState<HTMLDivElement | null>(null);
  const [recordPrimary, setRecordPrimary] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState(isBatchManagement ? "pool" : isReports ? "reports" : "batches");
  const [batchPicker, setBatchPicker] = useState(false);
  const [pendingNewRecord, setPendingNewRecord] = useState(false);
  const [method, setMethod] = useState<QuarantineMethod>(
    mode === "quarantine-parasite" ? "parasite" : mode === "quarantine-pcr" ? "pcr" : "elisa_mouse",
  );
  const listVisible = !editor && !batchId && tab !== "pool" && tab !== "suppliers";
  const batches = useQuarantineBatches(
    search,
    page,
    (listVisible && isBatchManagement) || batchPicker,
    batchPicker || isBatchManagement || isReports ? undefined : mode === "quarantine-elisa" ? "elisa" : method,
    batchPicker ? "" : batchState,
  );
  const detail = useQuarantineDetail(batchId);
  const catalog = useQuarantineCatalog(
    batchPicker || pendingNewRecord || (Boolean(batchId) && !isReports && (!isBatchManagement || Boolean(testId))),
  );
  const tests =
    detail.data?.tests.filter(
      (t) =>
        isReports ||
        isBatchManagement ||
        (mode === "quarantine-elisa" ? t.method.startsWith("elisa") : t.method === method),
    ) ?? [];
  const selected = tests.find((t) => t.id === testId) ?? tests[0];
  function beginTest() {
    const nextMethod = isBatchManagement && selected ? selected.method : method;
    setEditor(emptyTest(batchId, nextMethod, catalog.data?.projects[nextMethod] ?? []));
  }
  const availableMethods = [...new Set(detail.data?.tests.map((test) => test.method) ?? [])];
  function openBatch(value: string, recordId = "") {
    setBatchId(value);
    setTestId(recordId);
    setEditor(null);
    setPendingNewRecord(false);
    if (isBatchManagement) setTab("batches");
    if (isReports) setTab("reports");
  }
  function startRecord(value: string) {
    openBatch(value);
    setBatchPicker(false);
    setPendingNewRecord(true);
  }
  function newBatch() {
    setInitialSources([]);
    setBatchEditor("new");
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
  const currentTypeTitle = mode === "quarantine-elisa" ? "ELISA检测" : methodLabels[method];
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
      {!editor && !batchId && (
        <header className="quarantine-page-heading">
          <Typography.Title level={3}>{title}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {isBatchManagement
              ? "登记覆盖来源、跟踪检测进展并确认整批检疫完成。"
              : isReports
                ? "检索已出具报告、查看历史版本与供应商检测趋势。"
                : "按检测记录管理样本、结果和原始资料，出具报告后保留完整版本。"}
          </Typography.Paragraph>
        </header>
      )}
      {!editor && !batchId && (isBatchManagement || isReports) && (
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
          onNew={newBatch}
          onCreate={(sources) => {
            setInitialSources(sources);
            setBatchEditor("new");
          }}
        />
      ) : tab === "suppliers" ? (
        <SupplierHistoryView onOpen={openBatch} />
      ) : (
        <>
          {listVisible && !isBatchManagement && (
            <RecordWorklist
              method={isReports ? undefined : mode === "quarantine-elisa" ? "elisa" : method}
              reports={isReports}
              onOpen={openBatch}
              onNew={() => setBatchPicker(true)}
            />
          )}
          {!editor && !batchId && isBatchManagement && (
            <CommandBar
              ariaLabel={`${title}列表操作`}
              filters={
                <>
                  <Select
                    aria-label="批次状态筛选"
                    value={batchState}
                    options={[
                      { value: "", label: "全部批次" },
                      { value: "open", label: "检疫中" },
                      { value: "completed", label: "已检疫" },
                    ]}
                    onChange={(value) => {
                      setBatchState(value);
                      setPage(1);
                    }}
                  />
                  <Input.Search
                    aria-label="搜索检疫批次"
                    placeholder="按检疫批次编号搜索"
                    allowClear
                    onSearch={(v) => {
                      setSearch(v);
                      setPage(1);
                    }}
                  />
                </>
              }
              primaryAction={
                !isReports && (
                  <Button type="primary" onClick={isBatchManagement ? newBatch : () => setBatchPicker(true)}>
                    {isBatchManagement ? "新建检疫批次" : `新建${title}记录`}
                  </Button>
                )
              }
            />
          )}
          {listVisible && isBatchManagement && batches.error && (
            <Alert
              type="error"
              title={batches.error.message}
              action={<Button onClick={() => void batches.refetch()}>重试</Button>}
            />
          )}
          {listVisible && isBatchManagement && !batches.isPending && <ListRefreshStatus active={batches.isFetching} />}
          {!editor && !batchId && isBatchManagement && batches.isLoading ? (
            <PageSkeleton label="检疫批次" variant="table" />
          ) : !editor && !batchId && isBatchManagement ? (
            <Table
              rowKey="id"
              size="small"
              dataSource={batches.data?.items ?? []}
              scroll={{ x: 1000 }}
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
                { title: "检测进度", render: (_, b) => `${b.issuedCount ?? 0} / ${b.recordCount ?? 0} 条已出具` },
                {
                  title: "检测类型",
                  render: (_, b) => (
                    <Space wrap>
                      {b.methods?.map((method) => (
                        <Tag key={method}>{methodLabels[method]}</Tag>
                      ))}
                    </Space>
                  ),
                },
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
          {batchId && !editor && !detail.data && (
            <CommandBar
              ariaLabel="检疫批次详情操作"
              actions={<Button onClick={() => openBatch("")}>返回列表</Button>}
            />
          )}
          {batchId && detail.error && (
            <Alert
              type="error"
              title={detail.error.message}
              action={<Button onClick={() => void detail.refetch()}>重试</Button>}
            />
          )}
          {batchId && !editor && detail.data && <ListRefreshStatus active={detail.isFetching} />}
          {batchId && detail.isLoading && <PageSkeleton label="检疫批次详情" variant="detail" />}
          {detail.data && (
            <>
              {!editor && (
                <>
                  <CommandBar
                    ariaLabel="检疫批次详情操作"
                    context={
                      <Space orientation="vertical" size={0}>
                        <span>{`${isBatchManagement || isReports ? title : currentTypeTitle} · ${detail.data.item.name}`}</span>
                        {(!isBatchManagement || Boolean(testId)) && selected && (
                          <Typography.Text type="secondary">{`${methodLabels[selected.method]} · ${selected.testDate || "日期未填"} · ${selected.state === "issued" ? "已出具" : "草稿"}${selected.retestOf ? " · 复检" : ""}${selected.correctionOf ? " · 更正" : ""}`}</Typography.Text>
                        )}
                      </Space>
                    }
                    filters={
                      !isReports &&
                      !isBatchManagement &&
                      !detail.data.item.completedAt &&
                      mode === "quarantine-elisa" && (
                        <Select
                          aria-label="新建记录动物种类"
                          value={method}
                          options={[
                            { value: "elisa_mouse", label: "小鼠" },
                            { value: "elisa_rat", label: "大鼠" },
                          ]}
                          onChange={setMethod}
                        />
                      )
                    }
                    actions={
                      <>
                        <Button onClick={() => openBatch("")}>返回列表</Button>
                        {(!isBatchManagement || Boolean(testId)) && selected && (
                          <>
                            {!isReports && !detail.data.item.completedAt && (
                              <Button disabled={!catalog.data} onClick={() => beginTest()}>
                                新建检测记录
                              </Button>
                            )}
                            <div ref={setRecordActions} />
                          </>
                        )}
                      </>
                    }
                    primaryAction={
                      isBatchManagement && !testId ? (
                        <Button
                          type="primary"
                          disabled={Boolean(detail.data.item.completedAt)}
                          onClick={() => setBatchEditor(detail.data.item)}
                        >
                          编辑检疫批次
                        </Button>
                      ) : selected ? (
                        <div ref={setRecordPrimary} />
                      ) : !isReports && !detail.data.item.completedAt ? (
                        <Button type="primary" disabled={!catalog.data} onClick={() => beginTest()}>
                          新建检测记录
                        </Button>
                      ) : undefined
                    }
                  />
                  <BatchOverview
                    detail={detail.data}
                    compact={!isBatchManagement || Boolean(testId)}
                    onRecord={setTestId}
                  />
                </>
              )}
              {isBatchManagement && !testId && !editor && (
                <BatchCompletion key={detail.data.item.id} detail={detail.data} />
              )}
              {(!isBatchManagement || Boolean(testId)) && (
                <>
                  {!isReports && catalog.error && (
                    <Alert
                      type="error"
                      title={catalog.error.message}
                      action={<Button onClick={() => void catalog.refetch()}>重试</Button>}
                    />
                  )}
                  {!editor && (
                    <Tabs
                      aria-label="检测记录"
                      activeKey={selected?.id}
                      onChange={(value) => {
                        setTestId(value);
                        setEditor(null);
                      }}
                      items={tests.map((t) => ({
                        key: t.id,
                        label: `${methodLabels[t.method]} · ${t.testDate || "日期未填"} · ${t.state === "issued" ? "已出具" : "草稿"}${t.retestOf ? " · 复检" : ""}${t.correctionOf ? " · 更正" : ""}`,
                      }))}
                    />
                  )}
                  {editor ? (
                    <TestEditor
                      key={editor.id}
                      initial={editor}
                      detail={detail.data}
                      batch={detail.data.item}
                      onCancel={() => setEditor(null)}
                      onSaved={(test) => setTestId(test.id)}
                    />
                  ) : selected ? (
                    <TestDetail
                      key={selected.id}
                      test={selected}
                      showReports={isReports}
                      actionsContainer={recordActions}
                      primaryContainer={recordPrimary}
                      detail={detail.data}
                      onEdit={() => setEditor(selected)}
                      onCreated={(value) => {
                        setTestId(value);
                      }}
                    />
                  ) : (
                    <Empty
                      description={
                        tests.length ? (
                          "选择检测记录查看内容和报告"
                        ) : isReports ? (
                          "此批次暂无已出具报告。"
                        ) : (
                          <Space orientation="vertical" size={4}>
                            <span>当前{methodLabels[method]}在此批次尚无检测记录。</span>
                            {availableMethods.length > 0 && (
                              <Space wrap>
                                <span>已有：</span>
                                {availableMethods.map((availableMethod) => (
                                  <Tag key={availableMethod}>{methodLabels[availableMethod]}</Tag>
                                ))}
                              </Space>
                            )}
                          </Space>
                        )
                      }
                    >
                      {!isReports && !tests.length && !detail.data.item.completedAt && (
                        <Button type="primary" disabled={!catalog.data} onClick={() => beginTest()}>
                          新建{methodLabels[method]}记录
                        </Button>
                      )}
                    </Empty>
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
          选择本次检测所属的批次。已有来源会带入样本登记，完成后的批次不可追加检测。
        </Typography.Paragraph>
        <Space wrap>
          {mode === "quarantine-elisa" && (
            <Select
              aria-label="新建记录动物种类"
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
        {batches.error && (
          <Alert
            type="error"
            title={batches.error.message}
            action={<Button onClick={() => void batches.refetch()}>重试</Button>}
          />
        )}
        <ListRefreshStatus active={batches.isFetching && !batches.isPending} />
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
