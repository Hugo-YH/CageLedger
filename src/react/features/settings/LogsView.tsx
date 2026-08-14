import { Fragment, useState } from "react";
import { Card, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { useAuditEvents } from "../../api/administration";
import type { AuditEvent } from "../../api/contracts";
import { formatDateTime, PageSkeleton, PageState, Pager } from "../../components/WorkspaceUi";
import { DataTable } from "../../components/ui";

export function LogsView() {
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
    <section className="workspace-view settings-workspace" data-feature="administration">
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
            <PageSkeleton label="操作日志" variant="table" />
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
