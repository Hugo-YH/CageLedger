import { useState } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import { App, Button, Empty, Popconfirm, Space, Tag } from "antd";
import type { TableProps } from "antd";

import type { ReimbursementClaim, SessionUser } from "../../../api/contracts";
import { useDeleteReimbursementClaim, useReimbursementClaims } from "../../../api/reimbursementLedger";
import { DataTable } from "../../../components/ui";
import { LedgerColumnTitle, QueryFeedback } from "./LedgerListShared";
import { claimStatusLabels, moneyColumn } from "./ledgerListModel";

const PAGE = { limit: 20, offset: 0 };

export function ClaimsPanel({ user, onOpen }: { user: SessionUser; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const params = { ...PAGE, sortKey: sort.key, sortDir: sort.dir, columnFilters: filters };
  const { message } = App.useApp();
  const query = useReimbursementClaims(params);
  const deleteClaim = useDeleteReimbursementClaim();
  const [deletingId, setDeletingId] = useState("");
  const items = query.data?.items || [];

  async function deleteFor(claimId: string) {
    setDeletingId(claimId);
    try {
      await deleteClaim.mutateAsync(claimId);
      message.success("报销单已删除");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除报销单失败");
    } finally {
      setDeletingId("");
    }
  }

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  }
  function setFilter(key: string, values: string[]) {
    setFilters((current) => ({ ...current, [key]: values }));
  }
  const title = (column: string, label: string, filterable = true, labelMap?: Record<string, string>) => (
    <LedgerColumnTitle
      column={column}
      filterable={filterable}
      label={label}
      labelMap={labelMap}
      onFilter={(values) => setFilter(column, values)}
      onSort={() => toggleSort(column)}
      params={params}
      list="reimbursement-claims"
      values={filters[column] || []}
    />
  );

  const columns: TableProps<ReimbursementClaim>["columns"] = [
    {
      key: "status",
      title: title("status", "状态", true, claimStatusLabels),
      render: (_, item) => <Tag>{claimStatusLabels[item.status]}</Tag>,
    },
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
      key: "actions",
      title: "操作",
      fixed: "right",
      render: (_, item) => (
        <Space size={4}>
          <Button size="small" onClick={() => onOpen(item.id)}>
            详情
          </Button>
          <Popconfirm
            description="删除后报销单及其附件、核销分摊一并移除；已确认核销的报销单需先撤销分摊。"
            okButtonProps={{ danger: true }}
            okText="删除"
            title="删除该报销单？"
            onConfirm={() => void deleteFor(item.id)}
          >
            <Button danger icon={<DeleteOutlined aria-hidden />} loading={deletingId === item.id} size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <section className="ledger-section" aria-label="报销单列表">
      <div className="ledger-toolbar">
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
