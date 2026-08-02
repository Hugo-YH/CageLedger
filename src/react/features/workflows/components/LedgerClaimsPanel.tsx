import { useState } from "react";
import { Button, Empty, Form, Input, Select, Tag } from "antd";
import type { TableProps } from "antd";

import type { ReimbursementClaim, SessionUser } from "../../../api/contracts";
import { useReimbursementClaims } from "../../../api/reimbursementLedger";
import { DataTable } from "../../../components/ui";
import { LedgerColumnTitle, QueryFeedback } from "./LedgerListShared";
import { LEDGER_CLAIMS_PATH, claimStatusLabels, moneyColumn } from "./ledgerListModel";

const PAGE = { limit: 20, offset: 0 };

export function ClaimsPanel({ user, onOpen }: { user: SessionUser; onOpen: (id: string) => void }) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const params = { ...PAGE, keyword, status, sortKey: sort.key, sortDir: sort.dir, columnFilters: filters };
  const query = useReimbursementClaims(params);
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
      path={LEDGER_CLAIMS_PATH}
      values={filters[column] || []}
    />
  );

  const columns: TableProps<ReimbursementClaim>["columns"] = [
    { key: "documentNumber", title: title("documentNumber", "报销单号"), dataIndex: "documentNumber" },
    { key: "fundingOwner", title: title("fundingOwner", "经费负责人"), dataIndex: "fundingOwner" },
    {
      key: "fundingLineCount",
      title: title("fundingLineCount", "经费明细", false),
      align: "right",
      render: (_, item) => item.fundingLineCount ?? item.fundingLines?.length ?? "-",
    },
    { ...moneyColumn("报销总额", "totalAmount"), key: "totalAmount", title: title("totalAmount", "报销总额", false) },
    {
      ...moneyColumn("已分摊", "allocatedAmount"),
      key: "allocatedAmount",
      title: title("allocatedAmount", "已分摊", false),
    },
    {
      ...moneyColumn("未分摊", "unallocatedAmount"),
      key: "unallocatedAmount",
      title: title("unallocatedAmount", "未分摊", false),
    },
    {
      key: "attachmentCount",
      title: title("attachmentCount", "附件", false),
      dataIndex: "attachmentCount",
      align: "right",
    },
    {
      key: "status",
      title: title("status", "状态", false),
      render: (_, item) => <Tag>{claimStatusLabels[item.status]}</Tag>,
    },
    {
      key: "actions",
      title: "操作",
      fixed: "right",
      render: (_, item) => (
        <Button size="small" onClick={() => onOpen(item.id)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <section className="ledger-section" aria-label="报销单列表">
      <div className="ledger-toolbar">
        <Form component={false} layout="inline">
          <Form.Item>
            <Input.Search
              aria-label="检索报销单"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="检索报销单号或经费负责人"
            />
          </Form.Item>
          <Form.Item>
            <Select
              aria-label="报销单状态"
              options={[
                { label: "全部状态", value: "all" },
                ...Object.entries(claimStatusLabels).map(([value, label]) => ({ label, value })),
              ]}
              value={status}
              onChange={setStatus}
            />
          </Form.Item>
        </Form>
        <Tag color="blue">{query.data?.page.total || 0} 张报销单</Tag>
      </div>
      <QueryFeedback
        error={query.isError}
        errorText="报销单加载失败"
        loading={query.isPending}
        loadingText="正在加载报销单..."
        retry={() => void query.refetch()}
      />
      {!query.isPending && !query.isError ? (
        <DataTable
          className="antd-data-table reimbursement-table"
          columns={columns}
          dataSource={items}
          locale={{
            emptyText: <Empty description={user.role === "admin" ? "尚未创建报销单" : "尚未创建本人报销单"} />,
          }}
          pagination={false}
          resizeKey="reimbursement-claims"
          rowKey="id"
          scroll={{ x: 1050 }}
        />
      ) : null}
    </section>
  );
}
