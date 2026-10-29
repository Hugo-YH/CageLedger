import { formatPersonNames } from "../../../domain/personNames";
import { Empty, Input, Typography, type TableProps } from "antd";
import { useEffect, useMemo, useState } from "react";

import type { PiOverview } from "../../api/dashboardOverview";
import { DataTable } from "../../components/ui";

const PAGE_SIZE = 5;
const cny = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const columns: TableProps<PiOverview>["columns"] = [
  {
    title: "项目负责人",
    dataIndex: "pi",
    key: "pi",
    render: (value: string) => formatPersonNames(value),
    width: "45%",
    ellipsis: { showTitle: true },
  },
  {
    title: "伦理号数量",
    dataIndex: "iacucCount",
    key: "iacucCount",
    width: "20%",
    align: "right",
  },
  {
    title: "饲养费（元）",
    dataIndex: "amount",
    key: "amount",
    width: "35%",
    align: "right",
    render: (amount: number, item: PiOverview) =>
      item.amountState && item.amountState !== "ready" ? (
        <Typography.Text
          title={item.amountError || undefined}
          type={item.amountState === "error" ? "warning" : "secondary"}
        >
          {item.amountState === "error" ? "待核查" : "待核算"}
        </Typography.Text>
      ) : (
        <Typography.Text className="ant-dashboard-pi-amount" type={amount === 0 ? "secondary" : undefined}>
          {cny.format(amount)}
        </Typography.Text>
      ),
  },
];

export function PiFeeSummary({ items }: { items: PiOverview[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return keyword ? items.filter((item) => item.pi.toLocaleLowerCase("zh-CN").includes(keyword)) : items;
  }, [items, search]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const allZero =
    items.length > 0 && items.every((item) => (!item.amountState || item.amountState === "ready") && item.amount === 0);
  const unavailable = items.filter((item) => item.amountState === "pending" || item.amountState === "error").length;

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <section aria-label="负责人饲养费统计" className="ant-dashboard-pi-summary">
      <div className="ant-dashboard-pi-toolbar">
        <div className="ant-dashboard-pi-context">
          <Typography.Text type="secondary">共 {items.length} 位项目负责人</Typography.Text>
          {allZero ? <Typography.Text type="secondary">当前统计金额均为 0.00 元</Typography.Text> : null}
          {unavailable ? (
            <Typography.Text type="secondary">{unavailable} 位负责人金额待核算或核查</Typography.Text>
          ) : null}
        </div>
        <Input.Search
          allowClear
          aria-label="搜索项目负责人"
          className="ant-dashboard-pi-search"
          placeholder="搜索项目负责人"
          value={search}
          onSearch={() => setPage(1)}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable<PiOverview>
        className="ant-dashboard-pi-table"
        columns={columns}
        dataSource={filteredItems}
        locale={{
          emptyText: <Empty description={items.length ? "未找到匹配的项目负责人" : "暂无项目负责人统计"} />,
        }}
        pagination={
          filteredItems.length
            ? {
                current: currentPage,
                pageSize: PAGE_SIZE,
                showSizeChanger: false,
                showTotal: (total) => `共 ${total} 位项目负责人`,
                total: filteredItems.length,
                onChange: setPage,
              }
            : false
        }
        rowKey="pi"
        size="small"
        scroll={{ x: "100%" }}
        tableLayout="fixed"
      />
    </section>
  );
}
