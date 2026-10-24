import { memo } from "react";
import { Empty, Space, Tag, Typography } from "antd";
import type { SessionUser } from "../../../api/contracts";
import type { BillingWorkflow } from "../../../api/workflows";
import { DataTable } from "../../../components/ui";
import type { ListDensity } from "../../../components/ui/ListViewControls";
import { FeeTypeTag, ReimbursementReturnTag } from "../../../components/BillingTags";
import { workflowTagColor } from "../../../components/billingTagColors";
import { tagColors } from "../../../../theme/visual-system.mjs";
import { WorkflowColumnTitle } from "./WorkflowColumnTitle";
import { WorkflowTableActions } from "./WorkflowTableActions";
import { WorkflowLockCheckbox } from "./WorkflowLockControls";
import type { WorkflowRevokeTarget } from "./WorkflowRevokeModal";

const workflowStatusMeta: Record<string, { label: string }> = {
  statement_generated: { label: "已生成" },
  statement_sent: { label: "已发起" },
  statement_archived: { label: "未归档" },
  statement_locked: { label: "已归档" },
  statement_signed_returned: { label: "已交回登记（历史）" },
  submitted_to_finance: { label: "已提交财务（历史）" },
};

export const BillingWorkflowTable = memo(function BillingWorkflowTable({
  user,
  items,
  refreshing,
  readOnly = false,
  density,
  filters,
  selectedLockable,
  allLockableSelected,
  hasLockableItems,
  onToggleLockable,
  onToggleAllLockable,
  onSort,
  onFilter,
  onRegister,
  onDetail,
  onRevoke,
}: {
  user: SessionUser;
  items: BillingWorkflow[];
  refreshing: boolean;
  readOnly?: boolean;
  density: ListDensity;
  filters: Record<string, string[]>;
  selectedLockable: string[];
  allLockableSelected: boolean;
  hasLockableItems: boolean;
  onToggleLockable: (item: BillingWorkflow, checked: boolean) => void;
  onToggleAllLockable: () => void;
  onSort: (key: string) => void;
  onFilter: (key: string, values: string[]) => void;
  onRegister: (item: BillingWorkflow) => void;
  onDetail: (item: BillingWorkflow) => void;
  onRevoke: (target: WorkflowRevokeTarget) => void;
}) {
  function columnTitle(column: string, label: string, filterColumn = column) {
    return (
      <WorkflowColumnTitle
        column={filterColumn}
        columnFilters={filters}
        label={label}
        values={filters[filterColumn] || []}
        onFilter={(values) => onFilter(filterColumn, values)}
        onSort={() => onSort(column)}
      />
    );
  }

  const columns = [
    ...(user.billingLockAllowed
      ? [
          {
            key: "selection",
            title: (
              <WorkflowLockCheckbox
                aria-label="全选当前页可锁定的结算流程"
                checked={allLockableSelected}
                disabled={!hasLockableItems}
                onChange={onToggleAllLockable}
              />
            ),
            width: 44,
            render: (_: unknown, item: BillingWorkflow) => (
              <WorkflowLockCheckbox
                aria-label={`选择 ${item.pi} ${item.month} 结算流程`}
                checked={selectedLockable.includes(item.id)}
                disabled={item.workflowStatus !== "statement_sent" && item.workflowStatus !== "statement_archived"}
                onChange={(event) => onToggleLockable(item, event.target.checked)}
              />
            ),
          },
        ]
      : []),
    {
      key: "feeType",
      title: "费用类型",
      width: 110,
      render: (_: unknown, item: BillingWorkflow) => (
        <FeeTypeTag feeType={item.sourceType === "pi_merged_technical_service" ? "technical_service" : "feeding"} />
      ),
    },
    { key: "month", title: columnTitle("month", "结算月份"), dataIndex: "month", width: 100 },
    { key: "pi", title: columnTitle("pi", "项目负责人"), dataIndex: "pi", width: 140 },
    {
      key: "iacuc",
      title: columnTitle("iacuc", "IACUC"),
      width: 160,
      render: (_: unknown, item: BillingWorkflow) => (
        <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}>
          {item.iacucs.join("、") || "-"}
        </Typography.Paragraph>
      ),
    },
    {
      key: "manager",
      title: columnTitle("manager", "登记人员"),
      width: 110,
      render: (_: unknown, item: BillingWorkflow) => item.manager || "-",
    },
    {
      key: "totalAmount",
      title: columnTitle("totalAmount", "结算金额"),
      align: "right" as const,
      width: 110,
      render: (_: unknown, item: BillingWorkflow) => `¥${Number(item.totalAmount || 0).toFixed(2)}`,
    },
    {
      key: "workflowStatus",
      title: columnTitle("workflowStatus", "状态", "status"),
      width: 160,
      render: (_: unknown, item: BillingWorkflow) => {
        const showSubStatuses =
          item.workflowStatus === "statement_archived" || item.workflowStatus === "statement_locked";
        const reimbursementRequired = item.reimbursementRequired ?? Number(item.totalAmount || 0) > 0;
        return (
          <Space size={4} orientation="vertical">
            <Tag
              color={
                item.workflowStatus === "statement_locked"
                  ? tagColors.workflow.statement_locked
                  : tagColors.status.default
              }
            >
              {item.workflowStatus === "statement_locked" ? "已归档" : "未归档"}
            </Tag>
            {showSubStatuses ? (
              <>
                <Tag color={item.signedStatementReturned ? tagColors.document.statement : tagColors.status.default}>
                  {item.signedStatementReturned ? "结算单 已交回" : "结算单 未交回"}
                </Tag>
                {reimbursementRequired ? <ReimbursementReturnTag workflow={item} /> : null}
              </>
            ) : (
              <Tag color={workflowTagColor(item.workflowStatus)}>
                {workflowStatusMeta[item.workflowStatus]?.label || item.workflowStatus}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      key: "actions",
      title: "操作",
      fixed: "right" as const,
      width: 240,
      render: (_: unknown, item: BillingWorkflow) => (
        <WorkflowTableActions
          item={item}
          disabled={readOnly}
          canLock={Boolean(user.billingLockAllowed)}
          canWithdraw={item.canWithdraw ?? user.role === "admin"}
          onRegister={onRegister}
          onDetail={onDetail}
          onRevoke={onRevoke}
        />
      ),
    },
  ];

  return (
    <div className="ant-table-region" role="region" aria-label="结算流程表格" aria-busy={refreshing} tabIndex={0}>
      <DataTable
        refreshing={refreshing}
        className="antd-data-table reimbursement-table"
        size={density}
        columns={columns}
        dataSource={items}
        locale={{
          emptyText: (
            <Empty
              description={
                Object.values(filters).some((values) => values.length)
                  ? "没有符合当前筛选的结算流程"
                  : "当前没有结算流程"
              }
            />
          ),
        }}
        pagination={false}
        resizeKey="billing-workflows"
        rowKey="id"
        scroll={{ x: 1064 }}
      />
    </div>
  );
});
