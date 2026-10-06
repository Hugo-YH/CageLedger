import { useListPageBounds } from "../../../hooks/useListPageBounds";
import { queryKeys } from "../../../api/queryKeys";
import { BatchFailureDetails } from "../../../components/BatchFailureDetails";
import { useWorkspaceMemory, useWorkspaceScroll } from "../../../state/workspaceMemory";
import { ListViewControls, type ListDensity } from "../../../components/ui/ListViewControls";
import { Alert, Button, Checkbox, Empty, Popconfirm, Space, Tag, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";

import type { SessionUser } from "../../../api/contracts";
import type { BillingWorkflow } from "../../../api/workflows";
import { useAdvanceWorkflow, useBillingWorkflows } from "../../../api/workflows";
import { useBatchAdvanceWorkflow } from "../../../api/useBatchAdvanceWorkflow";
import { CommandBar, DataTable } from "../../../components/ui";
import { Pager } from "../../../components/WorkspaceUi";
import { reimbursementReturnStatus } from "../../../../domain/workflowStatus";
import { QueryFeedback } from "./LedgerListShared";
import { WorkflowColumnTitle } from "./WorkflowColumnTitle";
import { WorkflowDetailModal } from "./WorkflowDetailModal";
import { WorkflowReimbursementRecordingModal } from "./WorkflowReimbursementRecordingModal";
import { WorkflowRegistrationModal } from "./WorkflowRegistrationModal";
import { WorkflowRevokeModal, type WorkflowRevokeTarget } from "./WorkflowRevokeModal";
import { WorkflowTableActions } from "./WorkflowTableActions";
import { useSelectionScope } from "../../../hooks/useSelectionScope";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";

const workflowStatusMeta: Record<string, { label: string; color: string }> = {
  statement_generated: { label: "已生成", color: "gold" },
  statement_sent: { label: "已发起", color: "blue" },
  statement_archived: { label: "已归档", color: "green" },
  statement_locked: { label: "已锁定", color: "purple" },
  statement_signed_returned: { label: "已交回登记（历史）", color: "default" },
  submitted_to_finance: { label: "已提交财务（历史）", color: "default" },
};

export function BillingWorkflowPanel({ user }: { user: SessionUser }) {
  const [page, setPage] = useWorkspaceMemory("workflow:page", 1);
  const [pageSize, setPageSize] = useWorkspaceMemory("workflow:pageSize", 10);
  const [sort, setSort] = useWorkspaceMemory<{ key: string; dir: "asc" | "desc" }>("workflow:sort", {
    key: "month",
    dir: "desc",
  });
  const [filters, setFilters] = useWorkspaceMemory<Record<string, string[]>>("workflow:filters", {});
  const [density, setDensity] = useWorkspaceMemory<ListDensity>("workflow:density", "middle");
  const scopeRef = useRef(JSON.stringify(filters));
  useEffect(() => {
    scopeRef.current = JSON.stringify(filters);
  }, [filters]);
  const query = useBillingWorkflows({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  });
  const advance = useAdvanceWorkflow();
  const lockAction = useAsyncFormAction("结算流程操作失败，请重试");
  const batchAdvance = useBatchAdvanceWorkflow();
  const [registerTarget, setRegisterTarget] = useState<BillingWorkflow | null>(null);
  const [detailTarget, setDetailTarget] = useState<BillingWorkflow | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<BillingWorkflow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<WorkflowRevokeTarget | null>(null);
  const [selectedLockable, setSelectedLockable] = useState<string[]>([]);
  const selectedRows = useRef(new Map<string, BillingWorkflow>());
  const clearSelection = () => {
    setSelectedLockable([]);
    selectedRows.current.clear();
  };
  useSelectionScope(JSON.stringify([user.id, filters]), clearSelection, selectedLockable.length > 0);
  const [batchFailures, setBatchFailures] = useState<string[]>([]);
  const [batchLocking, setBatchLocking] = useState(false);
  const [batchLockNotice, setBatchLockNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(
    null,
  );
  useWorkspaceScroll("workflow-center", !query.isPending && !query.isError);
  const items = query.data?.items || [];
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const lockableItems = items.filter(
    (item) => item.workflowStatus === "statement_sent" || item.workflowStatus === "statement_archived",
  );
  const allLockableSelected =
    lockableItems.length > 0 && lockableItems.every((item) => selectedLockable.includes(item.id));

  function toggleLockable(item: BillingWorkflow, checked: boolean) {
    if (checked) selectedRows.current.set(item.id, item);
    else selectedRows.current.delete(item.id);
    setSelectedLockable((current) =>
      checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id),
    );
  }

  function toggleAllLockable() {
    for (const item of lockableItems) {
      if (allLockableSelected) selectedRows.current.delete(item.id);
      else selectedRows.current.set(item.id, item);
    }
    setSelectedLockable((current) => {
      if (allLockableSelected) {
        const currentIds = new Set(lockableItems.map((item) => item.id));
        return current.filter((id) => !currentIds.has(id));
      }
      return [...new Set([...current, ...lockableItems.map((item) => item.id)])];
    });
  }

  async function lockSelected() {
    if (lockAction.pending || batchLocking) return;
    const targets = selectedLockable
      .map((id) => selectedRows.current.get(id))
      .filter((item): item is BillingWorkflow => Boolean(item));
    if (!targets.length) return;
    const submittedScope = scopeRef.current;
    setBatchFailures([]);
    setBatchLocking(true);
    setBatchLockNotice({ kind: "info", text: `正在锁定结算流程 ${0}/${targets.length}…` });
    try {
      const result = await batchAdvance.run(
        targets.map((target) => ({
          workflowId: target.id,
          toStatus: "statement_locked",
          note: "批量锁定结算流程",
        })),
      );
      const failures = result.failures.map(
        (failure) =>
          `${targets.find((target) => target.id === failure.item.workflowId)?.pi || "结算流程"}（${failure.message}）`,
      );
      const failedIds = new Set(
        submittedScope === scopeRef.current ? result.failures.map((failure) => failure.item.workflowId) : [],
      );
      setSelectedLockable(targets.filter((target) => failedIds.has(target.id)).map((target) => target.id));
      selectedRows.current = new Map(
        targets.filter((target) => failedIds.has(target.id)).map((target) => [target.id, target]),
      );
      setBatchFailures(failures);
      setBatchLockNotice({
        kind: failures.length ? "error" : "success",
        text: failures.length
          ? `已锁定 ${targets.length - failures.length} 条结算流程；${failures.length} 条未完成。`
          : `已锁定 ${targets.length} 条结算流程。`,
      });
    } catch (error) {
      setBatchLockNotice({
        kind: "error",
        text: `批量结果未能同步，请刷新列表确认：${error instanceof Error ? error.message : "同步失败"}`,
      });
    } finally {
      setBatchLocking(false);
    }
  }

  useListPageBounds(
    page,
    pages,
    !query.isPending && !query.isError && !query.isPlaceholderData,
    setPage,
    queryKeys.workflowsRoot,
  );

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
    setPage(1);
  }

  function applyFilter(key: string, values: string[]) {
    setFilters((current) => ({ ...current, [key]: values }));
    setPage(1);
  }

  function columnTitle(column: string, label: string, filterColumn = column) {
    return (
      <WorkflowColumnTitle
        column={filterColumn}
        columnFilters={filters}
        label={label}
        values={filters[filterColumn] || []}
        onFilter={(values) => applyFilter(filterColumn, values)}
        onSort={() => toggleSort(column)}
      />
    );
  }

  const columns = [
    ...(user.billingLockAllowed
      ? [
          {
            key: "selection",
            title: (
              <Checkbox
                aria-label="全选当前页可锁定的结算流程"
                checked={allLockableSelected}
                disabled={!lockableItems.length || batchLocking || lockAction.pending}
                onChange={toggleAllLockable}
              />
            ),
            width: 44,
            render: (_: unknown, item: BillingWorkflow) => (
              <Checkbox
                aria-label={`选择 ${item.pi} ${item.month} 结算流程`}
                checked={selectedLockable.includes(item.id)}
                disabled={
                  (item.workflowStatus !== "statement_sent" && item.workflowStatus !== "statement_archived") ||
                  batchLocking ||
                  lockAction.pending
                }
                onChange={(event) => toggleLockable(item, event.target.checked)}
              />
            ),
          },
        ]
      : []),
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
            {item.workflowStatus === "statement_locked" ? <Tag color="purple">已锁定</Tag> : null}
            {showSubStatuses ? (
              <>
                <Tag color={item.signedStatementReturned ? "success" : "default"}>
                  {item.signedStatementReturned ? "结算单 已交回" : "结算单 未交回"}
                </Tag>
                {reimbursementRequired ? (
                  <Tag color={reimbursementReturnStatus(item).color}>{reimbursementReturnStatus(item).label}</Tag>
                ) : null}
              </>
            ) : (
              <Tag color={workflowStatusMeta[item.workflowStatus]?.color || "default"}>
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
          canLock={Boolean(user.billingLockAllowed)}
          disabled={batchLocking || lockAction.pending}
          loading={lockAction.pending && advance.variables?.workflowId === item.id}
          onRegister={setRegisterTarget}
          onDetail={setDetailTarget}
          onRevoke={setRevokeTarget}
          onAdvance={(toStatus, note) =>
            lockAction.run(() => advance.mutateAsync({ workflowId: item.id, toStatus, note }))
          }
        />
      ),
    },
  ];

  return (
    <section className="ledger-section" aria-label="结算流程列表">
      <CommandBar
        className="app-command-bar-list"
        ariaLabel="结算流程批量操作"
        filters={
          <ListViewControls
            filters={filters}
            onFiltersChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
            density={density}
            onDensity={setDensity}
            disabled={batchLocking || lockAction.pending}
          />
        }
        context={<Tag color="blue">{total} 条结算流程</Tag>}
        selection={
          user.billingLockAllowed
            ? { count: selectedLockable.length, onClear: clearSelection, pending: batchLocking }
            : undefined
        }
        sticky="selection"
        primaryAction={
          user.billingLockAllowed && selectedLockable.length ? (
            <Popconfirm
              title={`批量锁定 ${selectedLockable.length} 条结算流程？`}
              description="锁定后流程进入只读，单据交回状态保持当前记录；仅授权账号可解锁。"
              okText="批量锁定"
              cancelText="取消"
              onConfirm={lockSelected}
            >
              <Button
                icon={<LockOutlined aria-hidden />}
                loading={batchLocking}
                disabled={lockAction.pending || query.isPlaceholderData}
                type="primary"
              >
                批量锁定
              </Button>
            </Popconfirm>
          ) : undefined
        }
      />
      {lockAction.error ? <Alert role="alert" showIcon title={lockAction.error} type="error" /> : null}
      {batchLockNotice ? (
        <Alert
          className="ledger-batch-notice"
          role={batchLockNotice.kind === "error" ? "alert" : "status"}
          showIcon
          title={batchLocking ? `正在锁定结算流程，已处理 ${batchAdvance.completed} 条…` : batchLockNotice.text}
          description={<BatchFailureDetails key={batchFailures.join("|")} failures={batchFailures} />}
          type={batchLockNotice.kind}
        />
      ) : null}
      <QueryFeedback
        error={query.isError}
        errorText="结算流程加载失败"
        loading={query.isPending}
        loadingText="正在同步结算流程..."
        retry={() => void query.refetch()}
      />
      {!query.isPending && !query.isError ? (
        <div className="ant-table-region" role="region" aria-label="结算流程表格" tabIndex={0}>
          <DataTable
            refreshing={query.isFetching}
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
      ) : null}
      <Pager
        itemLabel="条"
        page={page}
        pageSize={pageSize}
        pages={pages}
        total={total}
        onPage={setPage}
        onPageSize={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
        }}
      />
      <WorkflowRegistrationModal
        target={registerTarget}
        onCancel={() => setRegisterTarget(null)}
        onRegistered={() => {
          setRegisterTarget(null);
        }}
      />
      <WorkflowDetailModal
        target={detailTarget}
        recordable={Boolean(
          detailTarget &&
          user.billingLockAllowed &&
          (detailTarget.reimbursementRequired ?? Number(detailTarget.totalAmount || 0) > 0) &&
          !detailTarget.reimbursementFormReturned,
        )}
        onCancel={() => setDetailTarget(null)}
        onRecord={(workflow) => {
          setDetailTarget(null);
          setRecordingTarget(workflow);
        }}
      />
      <WorkflowReimbursementRecordingModal
        target={recordingTarget}
        onCancel={() => setRecordingTarget(null)}
        onRecorded={() => {
          setRecordingTarget(null);
          void query.refetch();
        }}
      />
      <WorkflowRevokeModal target={revokeTarget} onCancel={() => setRevokeTarget(null)} />
    </section>
  );
}
