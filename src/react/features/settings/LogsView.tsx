import { useState } from "react";

import { useAuditEvents } from "../../api/administration";
import { formatDateTime, PageState, Pager, WorkspaceHeader } from "../../components/WorkspaceUi";

export function LogsView() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const query = useAuditEvents(pageSize, (page - 1) * pageSize);
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  return (
    <section className="workspace-view settings-workspace">
      <WorkspaceHeader
        kicker="审计工作台"
        title="操作日志"
        summary="查看系统写入操作、操作者和对象变更，追踪数据维护来源。"
        status={`${total} 条记录`}
      />
      <div className="workspace-body settings-workspace-body">
        <section className="panel large">
          <div className="panel-head">
            <div className="panel-title-line">
              <h2>操作记录</h2>
            </div>
          </div>
          {query.isPending ? (
            <PageState title="正在加载操作日志..." />
          ) : query.isError ? (
            <PageState title="操作日志加载失败" retry={() => query.refetch()} />
          ) : (
            <>
              <div className="audit-list">
                {query.data?.items.length ? (
                  query.data.items.map((item) => (
                    <article className="audit-row" key={item.id}>
                      <div>
                        <strong>{item.message || "操作记录"}</strong>
                        <p>
                          {item.actorDisplayName || "未记录账号"} · {item.action || "manual"}
                        </p>
                      </div>
                      <time>{formatDateTime(item.at)}</time>
                    </article>
                  ))
                ) : (
                  <PageState title="暂无操作日志" />
                )}
              </div>
              <Pager
                page={page}
                pages={pages}
                total={total}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={(value) => {
                  setPageSize(value);
                  setPage(1);
                }}
              />
            </>
          )}
        </section>
      </div>
    </section>
  );
}
