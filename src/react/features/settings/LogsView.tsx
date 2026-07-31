import { useState } from "react";
import { Card, Table, Typography } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";

import { useAuditEvents } from "../../api/administration";
import type { AuditEvent, SessionUser } from "../../api/contracts";
import { formatDateTime, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

export function LogsView({ navigate, user }: { navigate: (view: WorkspaceView) => void; user: SessionUser }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const query = useAuditEvents(pageSize, (page - 1) * pageSize);
  const total = query.data?.page.total || 0;
  const columns: ColumnsType<AuditEvent> = [
    {
      title: "操作记录",
      dataIndex: "message",
      key: "message",
      render: (message: string | undefined, item) => (
        <div className="audit-table-message">
          <Typography.Text strong>{message || "操作记录"}</Typography.Text>
          <Typography.Text type="secondary">
            {item.actorDisplayName || "未记录账号"} · {item.action || "manual"}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "发生时间",
      dataIndex: "at",
      key: "at",
      width: 196,
      align: "right",
      render: (at: string) => <Typography.Text type="secondary">{formatDateTime(at)}</Typography.Text>,
    },
  ];
  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    showQuickJumper: true,
    showTotal: (count) => `共 ${count} 条`,
    pageSizeOptions: [5, 10, 20, 50],
    onChange: (nextPage, nextPageSize) => {
      setPage(nextPage);
      if (nextPageSize !== pageSize) setPageSize(nextPageSize);
    },
  };
  return (
    <section className="workspace-view settings-workspace">
      <WorkspaceHeader
        kicker="审计工作台"
        title="操作日志"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="查看系统写入操作、操作者和对象变更，追踪数据维护来源。"
        status={`${total} 条记录`}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, user.role === "admin")}
      />
      <div className="workspace-body settings-workspace-body">
        <Card className="settings-log-card" title="操作记录">
          {query.isPending ? (
            <PageState title="正在加载操作日志..." />
          ) : query.isError ? (
            <PageState title="操作日志加载失败" retry={() => query.refetch()} />
          ) : (
            <Table
              className="app-data-table audit-log-table"
              columns={columns}
              dataSource={query.data?.items || []}
              rowKey="id"
              locale={{ emptyText: "暂无操作日志" }}
              pagination={pagination}
              size="middle"
            />
          )}
        </Card>
      </div>
    </section>
  );
}
