import { ActionIcon } from "../../components/ui/ActionIcon";
import { PageSkeleton } from "../../components/PageSkeleton";
import { CommandBar, ListRefreshStatus } from "../../components/ui";
import { useState, type Key } from "react";
import { Alert, Button, DatePicker, Input, Pagination, Select, Space, Table, Tag } from "antd";
import type { SupplierHistorySummary } from "../../../contracts/quarantine";
import { queryKeys } from "../../api/queryKeys";
import { useRetainedListData } from "../../hooks/useRetainedListData";
import {
  supplierDetailsPath,
  supplierSummaryPath,
  useSupplierHistoryDetails,
  useSupplierHistorySummary,
} from "../../api/quarantine";
import { methodLabels } from "./shared";

export function SupplierHistoryView({ onOpen }: { onOpen: (batchId: string, testId: string) => void }) {
  const [filters, setFilters] = useState<Record<string, string>>({ dateType: "arrival" });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Key[]>([]);
  const query = useSupplierHistorySummary(filters, page);
  const retained = useRetainedListData(
    query,
    [...queryKeys.quarantine, supplierSummaryPath(filters, page)],
    `supplier-summary:${filters.method || ""}`,
  );
  const set = (key: string, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setExpanded([]);
  };
  return (
    <>
      <CommandBar
        title="供应商历史"
        ariaLabel="供应商历史查询"
        filters={
          <>
            <Input.Search
              aria-label="查询供应商"
              placeholder="供应商"
              onSearch={(v) => set("supplier", v)}
              allowClear
            />
            <Select
              aria-label="历史日期类型"
              value={filters.dateType}
              onChange={(v) => set("dateType", v)}
              options={[
                { value: "arrival", label: "到货日期" },
                { value: "test", label: "检测日期" },
              ]}
            />
            <DatePicker.RangePicker
              aria-label="供应商历史日期范围"
              onChange={(v) => {
                setFilters((current) => ({
                  ...current,
                  dateFrom: v?.[0]?.format("YYYY-MM-DD") ?? "",
                  dateTo: v?.[1]?.format("YYYY-MM-DD") ?? "",
                }));
                setPage(1);
                setExpanded([]);
              }}
            />
            <Input.Search
              aria-label="历史动物种类"
              placeholder="动物种类"
              onSearch={(v) => set("species", v)}
              allowClear
            />
            <Select
              aria-label="历史检测方法"
              placeholder="全部方法"
              allowClear
              value={filters.method || undefined}
              options={Object.entries(methodLabels).map(([value, label]) => ({ value, label }))}
              onChange={(v) => set("method", v ?? "")}
            />
            <Select
              aria-label="历史检测结果"
              placeholder="全部结果"
              allowClear
              value={filters.result || undefined}
              options={[
                { value: "confirmed", label: "确认异常" },
                { value: "pending", label: "异常混样待确认" },
                { value: "resolved", label: "异常混样已复检" },
                { value: "normal", label: "抽检无异常" },
                { value: "incomplete", label: "未完成" },
              ]}
              onChange={(v) => set("result", v ?? "")}
            />
          </>
        }
      />
      <Alert
        type="info"
        title="各方法分别统计混样数和原始份数，不合计为动物数量。跨供应商混样计入各涉及供应商，明细标注共享混样；初检和复检分别展示。"
      />
      {query.error && (
        <Alert
          type="error"
          title={retained.data ? `${query.error.message}，暂显示上次结果` : query.error.message}
          action={
            <Button icon={<ActionIcon name="refresh" />} onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      )}
      <ListRefreshStatus active={query.isFetching && !query.isPending} />
      {retained.loading ? (
        <PageSkeleton embedded label="供应商历史" variant="table" />
      ) : retained.data ? (
        <Table
          rowKey={(r) => `${r.supplier}-${r.method}-${r.retest}`}
          aria-busy={query.isFetching}
          dataSource={retained.data?.items ?? []}
          scroll={{ x: 1100 }}
          pagination={{
            current: retained.data ? Math.floor(retained.data.page.offset / retained.data.page.limit) + 1 : page,
            pageSize: retained.data?.page.limit || 10,
            total: retained.data?.page.total,
            onChange: (next) => {
              setPage(next);
              setExpanded([]);
            },
            showSizeChanger: false,
          }}
          columns={[
            { title: "供应商", dataIndex: "supplier" },
            { title: "方法", render: (_, r) => methodLabels[r.method] },
            { title: "阶段", render: (_, r) => (r.retest ? "复检" : "初检") },
            { title: "到货批次数", dataIndex: "intakeCount" },
            { title: "检疫次数", dataIndex: "batchCount" },
            { title: "混样数", dataIndex: "poolCount" },
            { title: "原始份数", dataIndex: "portionCount" },
            { title: "确认异常", dataIndex: "confirmed" },
            { title: "待确认", dataIndex: "pending" },
            { title: "异常混样已复检", dataIndex: "resolved" },
            { title: "无异常", dataIndex: "normal" },
            { title: "未完成", dataIndex: "incomplete" },
          ]}
          expandable={{
            expandedRowKeys: expanded,
            onExpandedRowsChange: (keys) => setExpanded([...keys]),
            rowExpandable: () => !retained.blocked,
            expandedRowRender: (r) =>
              expanded.includes(`${r.supplier}-${r.method}-${r.retest}`) ? (
                <SupplierDetails
                  key={`${JSON.stringify(filters)}:${r.supplier}:${r.method}:${r.retest}`}
                  filters={filters}
                  group={r}
                  onOpen={onOpen}
                />
              ) : null,
          }}
        />
      ) : null}
    </>
  );
}

function SupplierDetails({
  filters,
  group,
  onOpen,
}: {
  filters: Record<string, string>;
  group: SupplierHistorySummary;
  onOpen: (batchId: string, testId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const query = useSupplierHistoryDetails(filters, group, page);
  const retained = useRetainedListData(
    query,
    [...queryKeys.quarantine, supplierDetailsPath(filters, group, page)],
    `supplier-details:${JSON.stringify([filters, group.supplier, group.method, group.retest])}`,
  );
  if (retained.loading) return <PageSkeleton embedded label="供应商历史明细" variant="detail" />;
  if (query.isError && !retained.data)
    return (
      <Alert type="error" title="明细读取失败" action={<Button onClick={() => void query.refetch()}>重试</Button>} />
    );
  return (
    <Space orientation="vertical">
      {query.isError && (
        <Alert
          type="error"
          title="明细更新失败，暂显示上次结果"
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      <Space wrap>
        {retained.data?.items.map((d) => (
          <span key={d.testId}>
            <Button disabled={retained.blocked} onClick={() => onOpen(d.batchId, d.testId)}>
              {d.batchName} · {d.testDate || "日期未填"}
            </Button>
            {d.sharedPools && <Tag>共享混样</Tag>}
          </span>
        ))}
      </Space>
      <Pagination
        current={retained.data ? Math.floor(retained.data.page.offset / retained.data.page.limit) + 1 : page}
        pageSize={retained.data?.page.limit || 10}
        total={retained.data?.page.total || 0}
        onChange={setPage}
        showSizeChanger={false}
      />
    </Space>
  );
}
