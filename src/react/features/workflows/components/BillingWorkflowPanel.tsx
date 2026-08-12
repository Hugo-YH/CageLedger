import { Alert, Button, Checkbox, Empty, Popconfirm, Space, Tag, Typography } from "antd";
import { useState } from "react";

import type { BillingWorkflow } from "../../../api/workflows";
import { fetchAllBillingWorkflows, useAdvanceWorkflow, useBillingWorkflows } from "../../../api/workflows";
import { DataTable } from "../../../components/ui";
import { formatDateTime, Pager } from "../../../components/WorkspaceUi";
import { QueryFeedback } from "./LedgerListShared";
import { WorkflowColumnTitle } from "./WorkflowColumnTitle";
import { WorkflowDetailModal } from "./WorkflowDetailModal";
import { WorkflowRegistrationModal } from "./WorkflowRegistrationModal";

const workflowStatusMeta: Record<string, { label: string; color: string }> = {
  statement_generated: { label: "已生成", color: "gold" },
  statement_sent: { label: "已发起", color: "blue" },
  statement_archived: { label: "已归档", color: "green" },
  statement_signed_returned: { label: "已交回登记（历史）", color: "default" },
  submitted_to_finance: { label: "已提交财务（历史）", color: "default" },
};

export function BillingWorkflowPanel() {
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
  const [detailTarget, setDetailTarget] = useState<BillingWorkflow | null>(null);
  const [selectedStartable, setSelectedStartable] = useState<BillingWorkflow[]>([]);
  const [selectingAll, setSelectingAll] = useState(false);
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchNotice, setBatchNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const items = query.data?.items || [];
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const startableItems = items.filter((item) => item.workflowStatus === "statement_generated");
  const allStartableSelected =
    startableItems.length > 0 &&
    startableItems.every((item) => selectedStartable.some((selected) => selected.id === item.id));

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
    setSelectedStartable([]);
    setPage(1);
  }

  function applyFilter(key: string, values: string[]) {
    setFilters((current) => ({ ...current, [key]: values }));
    setSelectedStartable([]);
    setPage(1);
  }

  function toggleSelected(item: BillingWorkflow, checked: boolean) {
    setSelectedStartable((current) =>
      checked
        ? current.some((selected) => selected.id === item.id)
          ? current
          : [...current, item]
        : current.filter((selected) => selected.id !== item.id),
    );
  }

  async function toggleAllStartable() {
    if (allStartableSelected) {
      const currentIds = new Set(startableItems.map((item) => item.id));
      setSelectedStartable((current) => current.filter((item) => !currentIds.has(item.id)));
      return;
    }
    setSelectingAll(true);
    try {
      const all = await fetchAllBillingWorkflows({
        limit: 100,
        offset: 0,
        sortKey: sort.key,
        sortDir: sort.dir,
        columnFilters: filters,
      });
      setSelectedStartable(all.filter((item) => item.workflowStatus === "statement_generated"));
    } finally {
      setSelectingAll(false);
    }
  }

  async function startSelected() {
    const targets = selectedStartable.filter((item) => item.workflowStatus === "statement_generated");
    if (!targets.length) return;
    setBatchStarting(true);
    setBatchProgress({ completed: 0, total: targets.length });
    setBatchNotice({ kind: "info", text: `正在发起结算流程 ${0}/${targets.length}…` });
    const failures: string[] = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      try {
        await advance.mutateAsync({
          workflowId: target.id,
          toStatus: "statement_sent",
          note: "批量发起结算流程",
        });
      } catch (error) {
        failures.push(`${target.pi}（${error instanceof Error ? error.message : "发起失败"}）`);
      }
      setBatchProgress((current) => ({ ...current, completed: current.completed + 1 }));
    }
    setSelectedStartable([]);
    setBatchStarting(false);
    setBatchNotice({
      kind: failures.length ? "error" : "success",
      text: failures.length
        ? `已发起 ${targets.length - failures.length} 条结算流程；${failures.length} 条未完成：${failures.join("、")}`
        : `已发起 ${targets.length} 条结算流程。`,
    });
    void query.refetch();
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
    {
      key: "selection",
      title: (
        <Checkbox
          aria-label="全选当前筛选结果可发起的结算流程"
          checked={allStartableSelected}
          disabled={!startableItems.length || batchStarting || selectingAll}
          onChange={() => void toggleAllStartable()}
        />
      ),
      width: 44,
      render: (_: unknown, item: BillingWorkflow) => (
        <Checkbox
          aria-label={`选择 ${item.pi} ${item.month} 结算流程`}
          checked={selectedStartable.some((selected) => selected.id === item.id)}
          disabled={item.workflowStatus !== "statement_generated" || batchStarting}
          onChange={(event) => toggleSelected(item, event.target.checked)}
        />
      ),
    },
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
      width: 110,
      render: (_: unknown, item: BillingWorkflow) => (
        <Tag color={workflowStatusMeta[item.workflowStatus]?.color || "default"}>
          {workflowStatusMeta[item.workflowStatus]?.label || item.workflowStatus}
        </Tag>
      ),
    },
    {
      key: "latestEventAt",
      title: columnTitle("latestEventAt", "最新时间"),
      width: 170,
      render: (_: unknown, item: BillingWorkflow) => {
        const at =
          item.archivedAt || item.signedReturnedAt || item.sentAt || item.generatedAt || item.latestEventAt || "";
        return at ? formatDateTime(at) : "-";
      },
    },
    {
      key: "actions",
      title: "操作",
      fixed: "right" as const,
      width: 220,
      render: (_: unknown, item: BillingWorkflow) => {
        if (item.workflowStatus === "statement_sent") {
          return (
            <Space size={4}>
              <Button type="primary" size="small" onClick={() => setRegisterTarget(item)}>
                交回登记
              </Button>
              <Popconfirm
                title="将该流程退回已生成？"
                description="流程回到已生成状态，可在按项目负责人结算或此处重新发起。"
                okText="撤回"
                cancelText="取消"
                onConfirm={async () => {
                  await advance.mutateAsync({
                    workflowId: item.id,
                    toStatus: "statement_generated",
                    note: "撤回已发起流程，退回已生成",
                  });
                  void query.refetch();
                }}
              >
                <Button danger size="small">
                  撤回
                </Button>
              </Popconfirm>
            </Space>
          );
        }
        if (item.workflowStatus === "statement_archived") {
          return (
            <Space size={4}>
              <Button size="small" onClick={() => setDetailTarget(item)}>
                查看留档
              </Button>
              <Popconfirm
                title="将该流程改回已发起？"
                description="流程回到等待交回登记状态，原留档信息保留，重新登记后覆盖。"
                okText="改回已发起"
                cancelText="取消"
                onConfirm={async () => {
                  await advance.mutateAsync({
                    workflowId: item.id,
                    toStatus: "statement_sent",
                    note: "撤回归档，改回已发起",
                  });
                  void query.refetch();
                }}
              >
                <Button danger size="small">
                  改回已发起
                </Button>
              </Popconfirm>
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
        {selectingAll ? <Typography.Text type="secondary">正在选择全部可发起的结算流程…</Typography.Text> : null}
        {selectedStartable.length ? (
          <Space>
            <Typography.Text type="secondary">已选 {selectedStartable.length} 条可发起</Typography.Text>
            <Popconfirm
              title={`批量发起 ${selectedStartable.length} 条结算流程？`}
              description="已生成的结算流程将进入已发起状态，等待课题组交回单据。"
              okText="批量发起"
              cancelText="取消"
              onConfirm={() => void startSelected()}
            >
              <Button type="primary" loading={batchStarting}>
                批量发起
              </Button>
            </Popconfirm>
          </Space>
        ) : null}
      </div>
      {batchNotice ? (
        <Alert
          className="ledger-batch-notice"
          role="status"
          showIcon
          title={batchNotice.text}
          type={batchNotice.kind}
        />
      ) : null}
      {batchStarting ? (
        <Alert
          className="ledger-batch-notice"
          role="status"
          showIcon
          title={`正在发起结算流程 ${batchProgress.completed}/${batchProgress.total}…`}
          type="info"
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
    </section>
  );
}
