import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Space, Tag, Typography } from "antd";

import {
  useConfirmReimbursementAllocation,
  useCreateReimbursementAllocation,
  useReimbursementClaim,
  useReimbursementClaims,
  useReverseReimbursementAllocation,
  useSettlementObligations,
} from "../../../api/reimbursementLedger";
import type { ReimbursementAllocation, SessionUser } from "../../../api/contracts";
import { formatMoney } from "../../../components/WorkspaceUi";
import { DataTable } from "../../../components/ui";
import type { TableFilterOption } from "../../../components/FilterableTableHeader";
import { LedgerColumnTitle } from "./LedgerListShared";
import { moneyColumn } from "./ledgerListModel";

const PAGE = { limit: 20, offset: 0 };
const allocationStatusLabels: Record<string, string> = { draft: "草稿", confirmed: "已确认", reversed: "已撤销" };
const LOCAL_FILTER_COLUMNS = ["sourcePi", "fundingOwner", "iacuc", "fundBookNo", "status"] as const;

export function ReconciliationPanel({ user, onOpenClaim }: { user: SessionUser; onOpenClaim: (id: string) => void }) {
  const claims = useReimbursementClaims({ ...PAGE, status: "all" });
  const obligations = useSettlementObligations({ ...PAGE });
  const [claimId, setClaimId] = useState("");
  const [lineId, setLineId] = useState("");
  const [obligationId, setObligationId] = useState("");
  const [amount, setAmount] = useState("");
  const detail = useReimbursementClaim(claimId);
  const create = useCreateReimbursementAllocation();
  const confirm = useConfirmReimbursementAllocation();
  const reverse = useReverseReimbursementAllocation();
  const [reverseTarget, setReverseTarget] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const selected = detail.data?.item;
  const lines = selected?.fundingLines || [];
  const selectedLine = lines.find((line) => line.id === lineId);
  const allocations = lines.flatMap((line) => line.allocations || []);
  useEffect(() => setLineId(""), [claimId]);

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  }
  function setFilter(key: string, values: string[]) {
    setFilters((current) => ({ ...current, [key]: values }));
  }

  const allocationOptions = useMemo(() => {
    const maps: Record<string, Map<string, number>> = Object.fromEntries(
      LOCAL_FILTER_COLUMNS.map((column) => [column, new Map<string, number>()]),
    );
    for (const item of allocations) {
      for (const column of LOCAL_FILTER_COLUMNS) {
        const value = String(item[column] ?? "");
        maps[column].set(value, (maps[column].get(value) ?? 0) + 1);
      }
    }
    return Object.fromEntries(
      LOCAL_FILTER_COLUMNS.map((column) => [
        column,
        [...maps[column].entries()]
          .map(([value, count]) => ({
            value,
            label: column === "status" ? (allocationStatusLabels[value] ?? value) : value || "（空）",
            count,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
      ]),
    );
  }, [allocations]);

  const visibleAllocations = useMemo(() => {
    const filtered = allocations.filter((item) =>
      Object.entries(filters).every(([column, values]) => {
        if (!values.length) return true;
        return values.includes(String(item[column as keyof ReimbursementAllocation] ?? ""));
      }),
    );
    if (!sort.key) return filtered;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = a[sort.key as keyof ReimbursementAllocation];
      const right = b[sort.key as keyof ReimbursementAllocation];
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left ?? "").localeCompare(String(right ?? ""), "zh-CN", { numeric: true }) * direction;
    });
  }, [allocations, filters, sort]);

  const title = (column: string, label: string, options: TableFilterOption[], filterable = true) => (
    <LedgerColumnTitle
      column={column}
      filterable={filterable}
      label={label}
      localOptions={options}
      onFilter={(values) => setFilter(column, values)}
      onSort={() => toggleSort(column)}
      params={PAGE}
      values={filters[column] || []}
    />
  );

  return (
    <section className="ledger-section reconciliation-section" aria-label="核销中心">
      <Card className="reconciliation-form-card" size="small" title="创建核销草稿">
        <Form className="reconciliation-picker" layout="vertical">
          <Form.Item label="报销单">
            <Select
              allowClear
              options={(claims.data?.items || []).map((claim) => ({
                label: `${claim.documentNumber} · ${claim.fundingOwner}`,
                value: claim.id,
              }))}
              placeholder="请选择报销单"
              value={claimId || undefined}
              onChange={(value) => setClaimId(value || "")}
            />
          </Form.Item>
          <Form.Item label="经费明细">
            <Select
              allowClear
              disabled={!selected}
              options={lines.map((line) => ({
                label: `${line.fundBookNo} · 可用 ${formatMoney(line.unallocatedAmount)}`,
                value: line.id,
              }))}
              placeholder="请选择经费本号"
              value={lineId || undefined}
              onChange={(value) => setLineId(value || "")}
            />
          </Form.Item>
          <Form.Item label="结算应收">
            <Select
              allowClear
              options={(obligations.data?.items || [])
                .filter((item) => item.outstandingAmount > 0)
                .map((item) => ({
                  label: `${item.month} · ${item.sourcePi} · ${item.iacuc} · 待核销 ${formatMoney(item.outstandingAmount)}`,
                  value: item.id,
                }))}
              placeholder="请选择结算应收"
              value={obligationId || undefined}
              onChange={(value) => setObligationId(value || "")}
            />
          </Form.Item>
          <Form.Item label="本次金额">
            <Input
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={selectedLine ? String(selectedLine.unallocatedAmount) : "0.00"}
            />
          </Form.Item>
          <Form.Item>
            <Button
              disabled={!claimId || !lineId || !obligationId}
              loading={create.isPending}
              type="primary"
              onClick={() =>
                void create
                  .mutateAsync({ claimId, fundingLineId: lineId, obligationId, amount: Number(amount) })
                  .then(() => {
                    setAmount("");
                    void detail.refetch();
                  })
              }
            >
              创建草稿
            </Button>
          </Form.Item>
        </Form>
      </Card>
      {selected ? (
        <Alert
          action={
            <Button size="small" onClick={() => onOpenClaim(selected.id)}>
              编辑报销单
            </Button>
          }
          description="费用产生项目负责人和报销经费负责人会同时保留在每条分摊记录中。"
          title={`当前报销单：${selected.documentNumber}`}
          showIcon
          type="info"
        />
      ) : null}
      <DataTable
        className="antd-data-table reimbursement-table"
        columns={[
          {
            key: "sourcePi",
            title: title("sourcePi", "费用产生负责人", allocationOptions.sourcePi),
            dataIndex: "sourcePi",
          },
          {
            key: "fundingOwner",
            title: title("fundingOwner", "报销经费负责人", allocationOptions.fundingOwner),
            dataIndex: "fundingOwner",
          },
          { key: "iacuc", title: title("iacuc", "IACUC", allocationOptions.iacuc), dataIndex: "iacuc" },
          {
            key: "fundBookNo",
            title: title("fundBookNo", "经费本号", allocationOptions.fundBookNo),
            dataIndex: "fundBookNo",
          },
          { ...moneyColumn("本次金额", "amount"), key: "amount", title: title("amount", "本次金额", [], false) },
          {
            key: "status",
            title: title("status", "状态", allocationOptions.status),
            render: (_, item) => (
              <Tag color={item.status === "confirmed" ? "green" : item.status === "draft" ? "gold" : "default"}>
                {item.status === "draft" ? "草稿" : item.status === "confirmed" ? "已确认" : "已撤销"}
              </Tag>
            ),
          },
          {
            key: "actions",
            title: "操作",
            fixed: "right",
            render: (_, item) => (
              <Space size={4}>
                {user.role === "admin" && item.status === "draft" ? (
                  <Button
                    size="small"
                    loading={confirm.isPending}
                    onClick={() => void confirm.mutateAsync(item.id).then(() => void detail.refetch())}
                  >
                    确认
                  </Button>
                ) : null}
                {user.role === "admin" && item.status === "confirmed" ? (
                  <Button danger size="small" onClick={() => setReverseTarget(item.id)}>
                    撤销
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
        dataSource={visibleAllocations}
        locale={{ emptyText: <Empty description="选择报销单后可创建与查看核销分摊" /> }}
        pagination={false}
        resizeKey="reimbursement-allocations"
        rowKey="id"
        scroll={{ x: 960 }}
      />
      <Modal
        cancelText="取消"
        confirmLoading={reverse.isPending}
        okButtonProps={{ danger: true, disabled: !reverseReason.trim() }}
        okText="确认撤销"
        open={Boolean(reverseTarget)}
        title="撤销核销"
        onCancel={() => setReverseTarget("")}
        onOk={() =>
          void reverse.mutateAsync({ id: reverseTarget, reason: reverseReason }).then(() => {
            setReverseTarget("");
            setReverseReason("");
            void detail.refetch();
          })
        }
      >
        <Typography.Paragraph type="secondary">撤销后会恢复经费明细与结算应收余额。</Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="撤销原因">
            <Input.TextArea rows={3} value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
