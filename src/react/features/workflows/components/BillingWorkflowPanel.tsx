import { Button, Empty, Popconfirm, Space, Tag, Typography } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { useState } from "react";

import type { BillingWorkflow, BillingWorkflowEvent } from "../../../api/workflows";
import { fetchWorkflowDetail, useAdvanceWorkflow, useBillingWorkflows } from "../../../api/workflows";
import { DataTable } from "../../../components/ui";
import { formatDateTime, Pager } from "../../../components/WorkspaceUi";
import { QueryFeedback } from "./LedgerListShared";
import { WorkflowColumnTitle } from "./WorkflowColumnTitle";
import { WorkflowDetailModal } from "./WorkflowDetailModal";
import { WorkflowReimbursementRecordingModal } from "./WorkflowReimbursementRecordingModal";
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
  const [detailTarget, setDetailTarget] = useState<{
    workflow: BillingWorkflow;
    events: BillingWorkflowEvent[];
  } | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<BillingWorkflow | null>(null);
  const items = query.data?.items || [];
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

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
      render: (_: unknown, item: BillingWorkflow) =>
        item.workflowStatus === "statement_archived" ? (
          <Space size={4} wrap>
            <Tag color={item.signedStatementReturned ? "success" : "default"}>
              {item.signedStatementReturned ? "结算单 ✅ 已交回" : "结算单 未交回"}
            </Tag>
            <Tag color={item.reimbursementFormReturned ? "success" : "default"}>
              {item.reimbursementFormReturned ? "报销单 ✅ 已交回" : "报销单 未交回"}
            </Tag>
          </Space>
        ) : (
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
                登记
              </Button>
              <Popconfirm
                title="将该流程退回已生成？"
                description="流程回到已生成状态，可在结算管理或此处重新发起。"
                okText="撤回"
                cancelText="取消"
                onConfirm={async () => {
                  await advance.mutateAsync({
                    workflowId: item.id,
                    toStatus: "statement_generated",
                    note: "撤回，退回已生成",
                  });
                  void query.refetch();
                }}
              >
                <Button danger icon={<UndoOutlined aria-hidden />} size="small">
                  撤回
                </Button>
              </Popconfirm>
            </Space>
          );
        }
        if (item.workflowStatus === "statement_archived") {
          return (
            <Space size={4}>
              <Button size="small" onClick={() => void openDetail(item)}>
                查看归档
              </Button>
              {!item.reimbursementFormReturned ? (
                <Button size="small" onClick={() => setRecordingTarget(item)}>
                  补录
                </Button>
              ) : null}
              <Popconfirm
                title="将该流程撤回？"
                description="流程回到等待交回登记状态，原归档信息保留，重新登记后覆盖。"
                okText="撤回"
                cancelText="取消"
                onConfirm={async () => {
                  await advance.mutateAsync({
                    workflowId: item.id,
                    toStatus: "statement_sent",
                    note: "撤回，退回已发起",
                  });
                  void query.refetch();
                }}
              >
                <Button danger icon={<UndoOutlined aria-hidden />} size="small">
                  撤回
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
      </div>
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
    </section>
  );
}
