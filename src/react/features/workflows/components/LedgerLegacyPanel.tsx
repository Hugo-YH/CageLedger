import { useState } from "react";
import { Alert, Button, Empty, Tag } from "antd";
import type { TableProps } from "antd";

import type { SessionUser } from "../../../api/contracts";
import { useLegacyReimbursements, useMigrateLegacyReimbursement } from "../../../api/reimbursementLedger";
import { formatMoney } from "../../../components/WorkspaceUi";
import { DataTable } from "../../../components/ui";
import { LedgerColumnTitle } from "./LedgerListShared";

const PAGE = { limit: 20, offset: 0 };

export function LegacyPanel({ user }: { user: SessionUser }) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const params = { ...PAGE, sortKey: sort.key, sortDir: sort.dir, columnFilters: filters };
  const query = useLegacyReimbursements(params);
  const migrate = useMigrateLegacyReimbursement();
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
      onFilter={(values) => setFilter(column, values)}
      onSort={() => toggleSort(column)}
      params={params}
      list="reimbursement-legacy"
      values={filters[column] || []}
    />
  );

  const columns: TableProps<Record<string, unknown>>["columns"] = [
    { key: "month", title: title("month", "月份"), render: (_, item) => String(item.month || "-") },
    { key: "pi", title: title("pi", "费用产生负责人"), render: (_, item) => String(item.pi || "-") },
    {
      key: "reimbursementFormNo",
      title: title("reimbursementFormNo", "报销单号"),
      render: (_, item) => String(item.reimbursementFormNo || "-"),
    },
    {
      key: "fundBookNo",
      title: title("fundBookNo", "经费本号"),
      render: (_, item) => String(item.fundBookNo || "-"),
    },
    {
      key: "payableAmount",
      title: title("payableAmount", "应缴", false),
      align: "right",
      render: (_, item) => formatMoney(Number(item.payableAmount || 0)),
    },
    {
      key: "paidAmount",
      title: title("paidAmount", "已缴", false),
      align: "right",
      render: (_, item) => formatMoney(Number(item.paidAmount || 0)),
    },
    {
      key: "actions",
      title: "迁入",
      fixed: "right",
      render: (_, item) =>
        user.role === "admin" && item.migrationEligible ? (
          <Button size="small" loading={migrate.isPending} onClick={() => void migrate.mutateAsync(String(item.id))}>
            迁入
          </Button>
        ) : (
          <Tag>待核对</Tag>
        ),
    },
  ];

  return (
    <section className="ledger-section" aria-label="历史台账">
      <Alert
        description="具备报销单号、经费本号及匹配结算应收的记录可由系统管理员迁入新核销体系。"
        title="历史台账保留只读展示"
        showIcon
        type="info"
      />
      <DataTable
        className="antd-data-table reimbursement-table"
        columns={columns}
        dataSource={items}
        locale={{ emptyText: <Empty description="当前没有历史台账记录" /> }}
        pagination={false}
        resizeKey="reimbursement-legacy"
        rowKey={(item) => String(item.id)}
        scroll={{ x: 860 }}
      />
    </section>
  );
}
