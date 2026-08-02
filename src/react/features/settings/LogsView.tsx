import { Fragment, useState } from "react";
import { Card, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuditEvents } from "../../api/administration";
import type { AuditEvent, SessionUser } from "../../api/contracts";
import { formatDateTime, PageState, Pager, WorkspaceHeader } from "../../components/WorkspaceUi";
import { DataTable } from "../../components/ui";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

export function LogsView({ navigate, user }: { navigate: (view: WorkspaceView) => void; user: SessionUser }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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
  const pages = Math.max(Math.ceil(total / pageSize), 1);
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
        <Card
          className="settings-log-card"
          title={
            <Typography.Title level={2} style={{ margin: 0 }}>
              操作记录
            </Typography.Title>
          }
        >
          {query.isPending ? (
            <PageState title="正在加载操作日志..." />
          ) : query.isError ? (
            <PageState title="操作日志加载失败" retry={() => query.refetch()} />
          ) : (
            <Fragment>
              <DataTable
                className="app-data-table audit-log-table"
                columns={columns}
                dataSource={query.data?.items || []}
                rowKey="id"
                resizeKey="audit-log"
                locale={{ emptyText: "暂无操作日志" }}
                pagination={false}
              />
              <Pager
                onPage={setPage}
                onPageSize={(nextSize) => {
                  setPageSize(nextSize);
                  setPage(1);
                }}
                page={page}
                pageSize={pageSize}
                pages={pages}
                total={total}
              />
            </Fragment>
          )}
        </Card>
      </div>
    </section>
  );
}
