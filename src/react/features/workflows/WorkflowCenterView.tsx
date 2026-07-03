import { useState } from "react";

import type { ReimbursementStatus, SessionUser } from "../../api/contracts";
import type { WorkspaceView } from "../../state/ui";
import { useReimbursements } from "../../api/workflows";
import { PageState, Pager, WorkspaceHeader } from "../../components/WorkspaceUi";
import { breadcrumb, billingSwitchItems } from "../shell/workspaceNavigation";
import { WorkflowDetail, WorkflowRow } from "./components/WorkflowDetails";

const currentMonth = new Date().toISOString().slice(0, 7);
const statusOptions: Array<[ReimbursementStatus | "all", string]> = [
  ["pending_submission", "待提交"],
  ["reimbursing", "报销中"],
  ["completed", "已完成"],
  ["all", "全部"],
];

export function WorkflowCenterView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [status, setStatus] = useState<ReimbursementStatus | "all">("pending_submission");
  const [month, setMonth] = useState(currentMonth);
  const [monthDraft, setMonthDraft] = useState(currentMonth);
  const [pi, setPi] = useState("");
  const [piDraft, setPiDraft] = useState("");
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const params = { limit: pageSize, offset: (page - 1) * pageSize, status, month, pi: pi.trim(), onlyUnpaid };
  const query = useReimbursements(params);
  const allSummary = useReimbursements({ limit: 1, offset: 0, status: "all" });
  const pendingSummary = useReimbursements({ limit: 1, offset: 0, status: "pending_submission" });
  const reimbursingSummary = useReimbursements({ limit: 1, offset: 0, status: "reimbursing" });
  const completedSummary = useReimbursements({ limit: 1, offset: 0, status: "completed" });
  const total = query.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const items = query.data?.items || [];
  const filterLabel = statusOptions.find(([value]) => value === status)?.[1] || "全部";
  return (
    <section className="workspace-view workflow-center-view">
      <WorkspaceHeader
        kicker="结算与报销台账中心"
        title="结算与报销台账"
        breadcrumbs={[breadcrumb("饲养费管理", () => navigate("billing-quantity-entry"))]}
        summary="按每月每项目负责人维护结算金额、报销登记和累计未缴，结算流程版本继续留在详情中追踪。"
        status={`当前筛选：${filterLabel}`}
        metrics={[
          { label: "台账总数", value: allSummary.data?.page.total || 0 },
          { label: "待提交", value: pendingSummary.data?.page.total || 0, tone: "warning" },
          { label: "报销中", value: reimbursingSummary.data?.page.total || 0, tone: "todo" },
          { label: "已完成", value: completedSummary.data?.page.total || 0, tone: "success" },
        ]}
        switcherLabel="饲养费功能"
        switcherItems={billingSwitchItems(navigate)}
      />
      <div className="workspace-body workflow-workspace-body">
        <section className="workflow-center-panel">
          <div className="panel large">
            <div className="panel-head">
              <div className="panel-title-line">
                <h2>报销台账</h2>
              </div>
              <div className="panel-head-actions">
                <div className="command-bar workflow-filter-toolbar reimbursement-toolbar">
                  <div className="command-bar-filters">
                    <div className="filter-row" role="group" aria-label="报销台账状态筛选">
                      {statusOptions.map(([value, label]) => (
                        <button
                          key={value}
                          className={`segmented ${status === value ? "active" : ""}`}
                          type="button"
                          onClick={() => {
                            setStatus(value);
                            setPage(1);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input
                      aria-label="结算月份"
                      type="month"
                      value={monthDraft}
                      onChange={(event) => setMonthDraft(event.target.value)}
                    />
                    <input
                      aria-label="检索项目负责人"
                      type="search"
                      value={piDraft}
                      onChange={(event) => setPiDraft(event.target.value)}
                      placeholder="检索项目负责人"
                    />
                    <label className="checkbox-label reimbursement-unpaid-toggle">
                      <input
                        type="checkbox"
                        checked={onlyUnpaid}
                        onChange={(event) => {
                          setOnlyUnpaid(event.target.checked);
                          setPage(1);
                        }}
                      />
                      仅看有欠缴
                    </label>
                  </div>
                  <div className="command-bar-actions">
                    <button
                      className="secondary info-button"
                      type="button"
                      onClick={() => {
                        setMonth(monthDraft);
                        setPi(piDraft);
                        setPage(1);
                      }}
                    >
                      检索
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {query.isPending ? (
              <PageState title="正在加载报销台账..." />
            ) : query.isError ? (
              <PageState title="报销台账加载失败" retry={() => query.refetch()} />
            ) : (
              <>
                <div className="list-meta">
                  <span>当前命中 {items.length} 条</span>
                  <span>
                    第 {page} / {pages} 页 · 共 {total} 条
                  </span>
                </div>
                <div className="table-wrap" role="region" tabIndex={0} aria-label="报销台账列表">
                  <table className="workflow-table reimbursement-table dense-table">
                    <thead>
                      <tr>
                        <th>结算月份</th>
                        <th>项目负责人</th>
                        <th>当前月应缴</th>
                        <th>累计未缴</th>
                        <th>结算流程状态</th>
                        <th>报销状态</th>
                        <th>经费本号</th>
                        <th>报销单号</th>
                        <th>最近更新</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length ? (
                        items.map((item) => (
                          <WorkflowRow key={item.id} item={item} onOpen={() => setSelectedId(item.id)} />
                        ))
                      ) : (
                        <tr>
                          <td colSpan={10}>当前筛选下没有报销台账。按项目负责人生成结算单后会自动进入这里。</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
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
          </div>
        </section>
      </div>
      {selectedId ? <WorkflowDetail id={selectedId} user={user} onClose={() => setSelectedId("")} /> : null}
    </section>
  );
}
