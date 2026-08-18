import { Alert, Button, Checkbox, Empty, Input, Modal, Popconfirm, Space, Tag, Typography } from "antd";
import { LockOutlined, UndoOutlined } from "@ant-design/icons";
import { useState } from "react";

import type { SessionUser } from "../../../api/contracts";
import type { BillingWorkflow, BillingWorkflowEvent } from "../../../api/workflows";
import { fetchWorkflowDetail, useAdvanceWorkflow, useBillingWorkflows } from "../../../api/workflows";
import { DataTable } from "../../../components/ui";
import { Pager } from "../../../components/WorkspaceUi";
import { reimbursementReturnStatus } from "../../../../domain/workflowStatus";
import { QueryFeedback } from "./LedgerListShared";
import { WorkflowColumnTitle } from "./WorkflowColumnTitle";
import { WorkflowDetailModal } from "./WorkflowDetailModal";
import { WorkflowReimbursementRecordingModal } from "./WorkflowReimbursementRecordingModal";
import { WorkflowRegistrationModal } from "./WorkflowRegistrationModal";

const workflowStatusMeta: Record<string, { label: string; color: string }> = {
  statement_generated: { label: "已生成", color: "gold" },
  statement_sent: { label: "已发起", color: "blue" },
  statement_archived: { label: "已归档", color: "green" },
  statement_locked: { label: "已锁定", color: "purple" },
  statement_signed_returned: { label: "已交回登记（历史）", color: "default" },
  submitted_to_finance: { label: "已提交财务（历史）", color: "default" },
};

export function BillingWorkflowPanel({ user }: { user: SessionUser }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const query = useBillingWorkflows({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  });
  const advance = useAdvanceWorkflow();
  const [registerTarget, setRegisterTarget] = useState<BillingWorkflow | null>(null);
  const [detailTarget, setDetailTarget] = useState<{
    workflow: BillingWorkflow;
    events: BillingWorkflowEvent[];
  } | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<BillingWorkflow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ workflow: BillingWorkflow; toStatus: string } | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [selectedLockable, setSelectedLockable] = useState<string[]>([]);
  const [batchLocking, setBatchLocking] = useState(false);
  const [batchLockNotice, setBatchLockNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(
    null,
  );
  const items = query.data?.items || [];
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const lockableItems = items.filter(
    (item) => item.workflowStatus === "statement_sent" || item.workflowStatus === "statement_archived",
  );
  const allLockableSelected =
    lockableItems.length > 0 && lockableItems.every((item) => selectedLockable.includes(item.id));

  function toggleLockable(item: BillingWorkflow, checked: boolean) {
    setSelectedLockable((current) =>
      checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id),
    );
  }

  function toggleAllLockable() {
    setSelectedLockable((current) => {
      if (allLockableSelected) {
        const currentIds = new Set(lockableItems.map((item) => item.id));
        return current.filter((id) => !currentIds.has(id));
      }
      return [...new Set([...current, ...lockableItems.map((item) => item.id)])];
    });
  }

  async function lockSelected() {
    const targets = items.filter(
      (item) =>
        (item.workflowStatus === "statement_sent" || item.workflowStatus === "statement_archived") &&
        selectedLockable.includes(item.id),
    );
    if (!targets.length) return;
    setBatchLocking(true);
    setBatchLockNotice({ kind: "info", text: `正在锁定结算流程 ${0}/${targets.length}…` });
    const failures: string[] = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      try {
        await advance.mutateAsync({
          workflowId: target.id,
          toStatus: "statement_locked",
          note: "批量锁定结算流程",
        });
      } catch (error) {
        failures.push(`${target.pi}（${error instanceof Error ? error.message : "锁定失败"}）`);
      }
      setBatchLockNotice({ kind: "info", text: `正在锁定结算流程 ${index + 1}/${targets.length}…` });
    }
    setSelectedLockable([]);
    setBatchLocking(false);
    setBatchLockNotice({
      kind: failures.length ? "error" : "success",
      text: failures.length
        ? `已锁定 ${targets.length - failures.length} 条结算流程；${failures.length} 条未完成：${failures.join("、")}`
        : `已锁定 ${targets.length} 条结算流程。`,
    });
    void query.refetch();
  }

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
    setPage(1);
  }

  function applyFilter(key: string, values: string[]) {
    setFilters((current) => ({ ...current, [key]: values }));
    setPage(1);
  }

  async function openDetail(item: BillingWorkflow) {
    try {
      const detail = await fetchWorkflowDetail(item.id);
      setDetailTarget({ workflow: detail.workflow, events: detail.events });
    } catch {
      // 详情加载失败时保持列表可用，不弹错误弹窗。
    }
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
                disabled={!lockableItems.length || batchLocking}
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
                  batchLocking
                }
                onChange={(event) => toggleLockable(item, event.target.checked)}
              />
            ),
          },
        ]
      : []),
    { key: "month", title: columnTitle("month", "结算月份"), dataIndex: "month", width: 110 },
    { key: "pi", title: columnTitle("pi", "项目负责人"), dataIndex: "pi", width: 180 },
    {
      key: "iacuc",
      title: columnTitle("iacuc", "IACUC"),
      width: 220,
      render: (_: unknown, item: BillingWorkflow) => item.iacucs.join("、") || "-",
    },
    {
      key: "manager",
      title: columnTitle("manager", "登记人员"),
      width: 150,
      render: (_: unknown, item: BillingWorkflow) => item.manager || "-",
    },
    {
      key: "totalAmount",
      title: columnTitle("totalAmount", "结算金额"),
      align: "right" as const,
      width: 130,
      render: (_: unknown, item: BillingWorkflow) => `¥${Number(item.totalAmount || 0).toFixed(2)}`,
    },
    {
      key: "workflowStatus",
      title: columnTitle("workflowStatus", "状态", "status"),
      width: 170,
      render: (_: unknown, item: BillingWorkflow) => {
        const showSubStatuses =
          item.workflowStatus === "statement_archived" || item.workflowStatus === "statement_locked";
        const reimbursementRequired = item.reimbursementRequired ?? Number(item.totalAmount || 0) > 0;
        return (
          <Space size={4} wrap>
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
      width: 220,
      render: (_: unknown, item: BillingWorkflow) => {
        const reimbursementRequired = item.reimbursementRequired ?? Number(item.totalAmount || 0) > 0;
        if (item.workflowStatus === "statement_sent") {
          return (
            <Space size={4}>
              <Button type="primary" size="small" onClick={() => setRegisterTarget(item)}>
                登记
              </Button>
              <Button
                danger
                icon={<UndoOutlined aria-hidden />}
                size="small"
                onClick={() => setRevokeTarget({ workflow: item, toStatus: "statement_generated" })}
              >
                撤回
              </Button>
              {user.billingLockAllowed ? (
                <Popconfirm
                  title="锁定该结算流程？"
                  description="锁定后流程进入只读，单据交回状态保持当前记录；仅授权账号可解锁。"
                  okText="锁定"
                  cancelText="取消"
                  onConfirm={async () => {
                    await advance.mutateAsync({
                      workflowId: item.id,
                      toStatus: "statement_locked",
                      note: "锁定结算流程",
                    });
                    void query.refetch();
                  }}
                >
                  <Button icon={<LockOutlined aria-hidden />} size="small">
                    锁定
                  </Button>
                </Popconfirm>
              ) : null}
            </Space>
          );
        }
        if (item.workflowStatus === "statement_archived") {
          return (
            <Space className="workflow-row-actions" size={4}>
              <Button size="small" type="primary" onClick={() => void openDetail(item)}>
                查看归档
              </Button>
              {reimbursementRequired && !item.reimbursementFormReturned ? (
                <Button size="small" onClick={() => setRecordingTarget(item)}>
                  补录
                </Button>
              ) : null}
              {user.billingLockAllowed ? (
                <Popconfirm
                  title="锁定该结算流程？"
                  description="锁定后流程进入只读，仅授权账号可补录或解锁。"
                  okText="锁定"
                  cancelText="取消"
                  onConfirm={async () => {
                    await advance.mutateAsync({
                      workflowId: item.id,
                      toStatus: "statement_locked",
                      note: "锁定结算流程",
                    });
                    void query.refetch();
                  }}
                >
                  <Button icon={<LockOutlined aria-hidden />} size="small">
                    锁定
                  </Button>
                </Popconfirm>
              ) : null}
              <Button
                danger
                icon={<UndoOutlined aria-hidden />}
                size="small"
                type="text"
                onClick={() => setRevokeTarget({ workflow: item, toStatus: "statement_sent" })}
              >
                撤回
              </Button>
            </Space>
          );
        }
        if (item.workflowStatus === "statement_locked") {
          const unlockStatus = item.signedStatementReturned ? "statement_archived" : "statement_sent";
          const unlockStatusLabel = unlockStatus === "statement_archived" ? "已归档" : "已发起";
          return (
            <Space className="workflow-row-actions" size={4}>
              <Button size="small" type="primary" onClick={() => void openDetail(item)}>
                查看归档
              </Button>
              {user.billingLockAllowed && reimbursementRequired && !item.reimbursementFormReturned ? (
                <Button size="small" onClick={() => setRecordingTarget(item)}>
                  补录
                </Button>
              ) : null}
              {user.billingLockAllowed ? (
                <Popconfirm
                  title="解锁该结算流程？"
                  description={`解锁后依据结算单交回状态回到${unlockStatusLabel}，已补录信息会保留。`}
                  okText="解锁"
                  cancelText="取消"
                  onConfirm={async () => {
                    await advance.mutateAsync({
                      workflowId: item.id,
                      toStatus: unlockStatus,
                      note: "解锁结算流程",
                    });
                    void query.refetch();
                  }}
                >
                  <Button icon={<LockOutlined aria-hidden />} size="small">
                    解锁
                  </Button>
                </Popconfirm>
              ) : null}
            </Space>
          );
        }
        return <Typography.Text type="secondary">待发起</Typography.Text>;
      },
    },
  ];

  return (
    <section className="ledger-section" aria-label="结算流程列表">
      <div className="ledger-toolbar">
        <Tag color="blue">{total} 条结算流程</Tag>
        {user.billingLockAllowed && selectedLockable.length ? (
          <Space>
            <Typography.Text type="secondary">已选 {selectedLockable.length} 条可锁定</Typography.Text>
            <Popconfirm
              title={`批量锁定 ${selectedLockable.length} 条结算流程？`}
              description="锁定后流程进入只读，单据交回状态保持当前记录；仅授权账号可解锁。"
              okText="批量锁定"
              cancelText="取消"
              onConfirm={() => void lockSelected()}
            >
              <Button icon={<LockOutlined aria-hidden />} loading={batchLocking} type="primary">
                批量锁定
              </Button>
            </Popconfirm>
          </Space>
        ) : null}
      </div>
      {batchLockNotice ? (
        <Alert
          className="ledger-batch-notice"
          role="status"
          showIcon
          title={batchLockNotice.text}
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
        <DataTable
          className="antd-data-table reimbursement-table"
          columns={columns}
          dataSource={items}
          locale={{ emptyText: <Empty description="当前没有结算流程" /> }}
          pagination={false}
          resizeKey="billing-workflows"
          rowKey="id"
          scroll={{ x: 1180 }}
        />
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
          void query.refetch();
        }}
      />
      <WorkflowDetailModal target={detailTarget} onCancel={() => setDetailTarget(null)} />
      <WorkflowReimbursementRecordingModal
        target={recordingTarget}
        onCancel={() => setRecordingTarget(null)}
        onRecorded={() => {
          setRecordingTarget(null);
          void query.refetch();
        }}
      />
      <Modal
        cancelText="取消"
        confirmLoading={advance.isPending}
        okButtonProps={{ danger: true, disabled: !revokeReason.trim() }}
        okText="确认撤回"
        open={Boolean(revokeTarget)}
        title="撤回结算流程"
        onCancel={() => {
          setRevokeTarget(null);
          setRevokeReason("");
        }}
        onOk={() => {
          if (!revokeTarget || !revokeReason.trim()) return;
          void advance
            .mutateAsync({
              workflowId: revokeTarget.workflow.id,
              toStatus: revokeTarget.toStatus,
              note: revokeReason.trim(),
            })
            .then(() => {
              setRevokeTarget(null);
              setRevokeReason("");
              void query.refetch();
            });
        }}
      >
        <Typography.Paragraph type="secondary">
          {revokeTarget?.toStatus === "statement_generated"
            ? "流程将退回已生成状态，可重新发起。"
            : "流程将退回等待交回登记状态，原归档信息保留。"}
        </Typography.Paragraph>
        <label htmlFor="workflow-revoke-reason">
          撤回原因
          <Input.TextArea
            id="workflow-revoke-reason"
            maxLength={500}
            placeholder="请填写撤回原因"
            rows={3}
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
          />
        </label>
      </Modal>
    </section>
  );
}
