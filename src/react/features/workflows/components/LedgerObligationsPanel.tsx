import { useState } from "react";
import { Empty, Form, Input, Space, Tag } from "antd";
import type { TableProps } from "antd";

import type { SettlementObligation } from "../../../api/contracts";
import { useSettlementObligations } from "../../../api/reimbursementLedger";
import { DataTable } from "../../../components/ui";
import { LedgerColumnTitle, QueryFeedback } from "./LedgerListShared";
import { LEDGER_OBLIGATIONS_PATH, moneyColumn } from "./ledgerListModel";

const PAGE = { limit: 20, offset: 0 };
const obligationStatusLabels: Record<string, string> = { settled: "已核销", pending: "待核销" };

export function ObligationsPanel() {
  const [month, setMonth] = useState("");
  const [sourcePi, setSourcePi] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const params = { ...PAGE, month, sourcePi, sortKey: sort.key, sortDir: sort.dir, columnFilters: filters };
  const query = useSettlementObligations(params);
  const items = query.data?.items || [];

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  }
  function setFilter(key: string, values: string[]) {
    setFilters((current) => ({ ...current, [key]: values }));
  }
  const title = (column: string, label: string, filterable = true) => (
    <LedgerColumnTitle
      column={column}
      filterable={filterable}
      label={label}
      labelMap={column === "status" ? obligationStatusLabels : undefined}
      onFilter={(values) => setFilter(column, values)}
      onSort={() => toggleSort(column)}
      params={params}
      path={LEDGER_OBLIGATIONS_PATH}
      values={filters[column] || []}
    />
  );

  const columns: TableProps<SettlementObligation>["columns"] = [
    { key: "month", title: title("month", "结算月份"), dataIndex: "month" },
    { key: "sourcePi", title: title("sourcePi", "费用产生项目负责人"), dataIndex: "sourcePi" },
    {
      key: "iacuc",
      title: title("iacuc", "IACUC"),
      render: (_, item) => (
        <Space size={4}>
          {item.iacuc}
          {item.obligationKind === "adjustment" ? <Tag color="gold">调整</Tag> : null}
        </Space>
      ),
    },
    { ...moneyColumn("应缴", "payableAmount"), key: "payableAmount", title: title("payableAmount", "应缴", false) },
    {
      ...moneyColumn("已核销", "allocatedAmount"),
      key: "allocatedAmount",
      title: title("allocatedAmount", "已核销", false),
    },
    {
      ...moneyColumn("待核销", "outstandingAmount"),
      key: "outstandingAmount",
      title: title("outstandingAmount", "待核销", false),
    },
    { key: "claimCount", title: title("claimCount", "关联报销单", false), dataIndex: "claimCount", align: "right" },
    {
      key: "status",
      title: title("status", "状态"),
      render: (_, item) => (
        <Tag color={item.status === "settled" ? "green" : "gold"}>
          {item.status === "settled" ? "已核销" : "待核销"}
        </Tag>
      ),
    },
  ];

  return (
    <section className="ledger-section" aria-label="结算应收列表">
      <div className="ledger-toolbar">
        <Form component={false} layout="inline">
          <Form.Item>
            <Input
              aria-label="结算月份"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Form.Item>
          <Form.Item>
            <Input.Search
              aria-label="费用产生项目负责人"
              value={sourcePi}
              onChange={(event) => setSourcePi(event.target.value)}
              placeholder="费用产生项目负责人"
            />
          </Form.Item>
        </Form>
        <Tag color="blue">{query.data?.page.total || 0} 笔应收</Tag>
      </div>
      <QueryFeedback
        error={query.isError}
        errorText="结算应收加载失败"
        loading={query.isPending}
        loadingText="正在同步结算应收..."
        retry={() => void query.refetch()}
      />
      {!query.isPending && !query.isError ? (
        <DataTable
          className="antd-data-table reimbursement-table"
          columns={columns}
          dataSource={items}
          locale={{ emptyText: <Empty description="当前没有可结算应收" /> }}
          pagination={false}
          resizeKey="reimbursement-receivables"
          rowKey="id"
          scroll={{ x: 960 }}
        />
      ) : null}
    </section>
  );
}
