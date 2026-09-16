import { useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, Input, Select, Space, Table, Tag, Typography } from "antd";
import type { QuarantineRecordRow, QuarantineWorklist } from "../../../contracts/quarantine";
import { useQuarantineQuery } from "../../api/quarantine";
import { CommandBar, ListRefreshStatus } from "../../components/ui";
import { methodLabels } from "./shared";

export function RecordWorklist({
  method,
  reports = false,
  onOpen,
  onNew,
}: {
  method?: string;
  reports?: boolean;
  onOpen: (batchId: string, testId: string) => void;
  onNew: () => void;
}) {
  const [filters, setFilters] = useState({ search: "", state: "", method: method ?? "", dateFrom: "", dateTo: "" });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ ...filters, offset: String((page - 1) * 30) });
  const query = useQuarantineQuery<QuarantineWorklist>(`${reports ? "reports" : "records"}?${params}`, true);
  const set = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  return (
    <>
      <CommandBar
        ariaLabel={reports ? "报告台账操作" : "检测记录列表操作"}
        context={
          <Space wrap>
            <Typography.Text strong>
              {reports ? "报告台账" : "检测记录"}
              <Typography.Text type="secondary"> · {query.data?.page.total ?? 0} 条</Typography.Text>
            </Typography.Text>
            <ListRefreshStatus active={query.isFetching && !query.isPending} />
          </Space>
        }
        filters={
          <>
            <Input.Search
              aria-label="搜索检测记录"
              placeholder={reports ? "报告号、批次、供应商或课题组" : "批次、供应商或课题组"}
              allowClear
              onSearch={(value) => set("search", value)}
            />
            {!reports && (
              <Select
                aria-label="检测记录状态"
                value={filters.state}
                options={[
                  { value: "", label: "全部状态" },
                  { value: "draft", label: "草稿" },
                  { value: "issued", label: "已出具" },
                ]}
                onChange={(value) => set("state", value)}
              />
            )}
            {(!method || method === "elisa") && (
              <Select
                aria-label="检测方法筛选"
                value={filters.method}
                options={[
                  { value: method ?? "", label: method === "elisa" ? "全部ELISA" : "全部检测方法" },
                  ...Object.entries(methodLabels)
                    .filter(([value]) => !method || value.startsWith("elisa"))
                    .map(([value, label]) => ({ value, label })),
                ]}
                onChange={(value) => set("method", value)}
              />
            )}
            <DatePicker.RangePicker
              aria-label="检测日期范围"
              onChange={(value) => {
                setFilters((current) => ({
                  ...current,
                  dateFrom: value?.[0]?.format("YYYY-MM-DD") ?? "",
                  dateTo: value?.[1]?.format("YYYY-MM-DD") ?? "",
                }));
                setPage(1);
              }}
            />
          </>
        }
        primaryAction={
          !reports && (
            <Button type="primary" onClick={onNew}>
              新建检测记录
            </Button>
          )
        }
        actions={
          <Button loading={query.isFetching} onClick={() => void query.refetch()}>
            刷新
          </Button>
        }
      />
      {!reports && (
        <Space wrap>
          <Tag>当前筛选 {query.data?.summary.total ?? 0} 条</Tag>
          <Tag color="processing">草稿 {query.data?.summary.draft ?? 0}</Tag>
          <Tag color="success">已出具 {query.data?.summary.issued ?? 0}</Tag>
        </Space>
      )}
      {query.error && (
        <Alert
          type="error"
          title={query.error.message}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      <Card size="small">
        <Table<QuarantineRecordRow>
          rowKey="id"
          size="small"
          loading={query.isPending}
          dataSource={query.data?.items ?? []}
          scroll={{ x: 1080 }}
          locale={{
            emptyText: <Empty description={reports ? "暂无符合条件的已出具报告" : "暂无符合条件的检测记录"} />,
          }}
          pagination={{
            current: page,
            pageSize: 30,
            total: query.data?.page.total,
            showSizeChanger: false,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 条`,
          }}
          columns={[
            ...(reports
              ? [
                  {
                    title: "报告编号 / 版本",
                    key: "report",
                    width: 240,
                    render: (_: unknown, row: QuarantineRecordRow) => (
                      <Space orientation="vertical" size={0}>
                        <Typography.Text strong>{row.number}</Typography.Text>
                        <Typography.Text type="secondary">第 {row.version} 版</Typography.Text>
                      </Space>
                    ),
                  },
                ]
              : []),
            { title: "检疫批次", dataIndex: "batchName", width: 180 },
            { title: "检测方法", render: (_, row) => methodLabels[row.method], width: 150 },
            { title: "检测日期", dataIndex: "testDate", width: 120, render: (value: string) => value || "待填写" },
            {
              title: "状态",
              width: 110,
              render: (_, row) => (
                <Space orientation="vertical" size={0}>
                  <Tag color={row.state === "issued" ? "success" : "processing"}>
                    {row.state === "issued" ? "已出具" : "草稿"}
                  </Tag>
                  {row.retestOf && <Tag>复检</Tag>}
                  {row.correctionOf && <Tag>更正</Tag>}
                </Space>
              ),
            },
            { title: "样本 / 项目", width: 110, render: (_, row) => `${row.sampleCount} / ${row.projectCount}` },
            ...(reports
              ? [
                  {
                    title: "出具人",
                    key: "issuer",
                    width: 100,
                    render: (_: unknown, row: QuarantineRecordRow) => row.issuedBy?.name || "—",
                  },
                ]
              : [
                  {
                    title: "结果提示",
                    key: "result",
                    width: 110,
                    render: (_: unknown, row: QuarantineRecordRow) =>
                      row.abnormalCount ? <Tag color="warning">{row.abnormalCount} 项阳性/可疑</Tag> : "—",
                  },
                ]),
            {
              title: "供应商",
              width: 200,
              render: (_, row) => <Typography.Text>{row.suppliers.join("、") || "—"}</Typography.Text>,
            },
            {
              title: reports ? "出具时间" : "最近更新",
              dataIndex: "updatedAt",
              width: 170,
              render: (value: string) => value?.replace("T", " ").slice(0, 19),
            },
            {
              title: "操作",
              key: "action",
              fixed: "right",
              width: 120,
              render: (_, row) => (
                <Button onClick={() => onOpen(row.batchId, row.testId)}>{reports ? "查看报告" : "查看检测记录"}</Button>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
