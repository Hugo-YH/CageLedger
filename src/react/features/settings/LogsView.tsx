import { Fragment, useState } from "react";
import { Alert, Button, Card, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { queryKeys } from "../../api/queryKeys";
import { useRetainedListData } from "../../hooks/useRetainedListData";
import { useAuditEvents } from "../../api/administration";
import type { AuditEvent } from "../../api/contracts";
import { formatDateTime, PageSkeleton, PageState, Pager } from "../../components/WorkspaceUi";
import { CommandBar, DataTable } from "../../components/ui";

export function LogsView() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const query = useAuditEvents(pageSize, (page - 1) * pageSize);
  const retained = useRetainedListData(
    query,
    queryKeys.auditEvents({ limit: pageSize, offset: (page - 1) * pageSize }),
    "audit-events",
  );
  const total = retained.data?.page.total || 0;
  const shownPageSize = retained.data?.page.limit || pageSize;
  const shownPage = retained.data ? Math.floor(retained.data.page.offset / shownPageSize) + 1 : page;
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
  const pages = Math.max(Math.ceil(total / shownPageSize), 1);
  return (
    <section className="workspace-view settings-workspace" data-feature="administration">
      <div className="workspace-body settings-workspace-body">
        <CommandBar title="操作记录" ariaLabel="操作记录" />
        <Card className="settings-log-card">
          {retained.loading ? (
            <PageSkeleton label="操作日志" variant="table" />
          ) : !retained.data && query.isError ? (
            <PageState title="操作日志加载失败" retry={() => query.refetch()} />
          ) : (
            <Fragment>
              {query.isError && (
                <Alert
                  type="error"
                  title="操作日志更新失败，暂显示上次结果"
                  action={<Button onClick={() => void query.refetch()}>重试</Button>}
                />
              )}
              <DataTable
                refreshing={query.isFetching}
                className="app-data-table audit-log-table"
                columns={columns}
                dataSource={retained.data?.items || []}
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
                page={shownPage}
                pageSize={shownPageSize}
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
