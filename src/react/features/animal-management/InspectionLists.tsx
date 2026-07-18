import { useState } from "react";

import type {
  AnimalInspectionDetail,
  FindingStatus,
  InspectionCatalogNode,
  InspectionFinding,
  InspectionModuleCode,
  SessionUser,
} from "../../api/contracts";
import {
  downloadAnimalInspectionPdf,
  useAnimalFindings,
  useAnimalInspection,
  useAnimalInspections,
  useResolveFinding,
  useUpdateFinding,
} from "../../api/animalManagement";
import { ModalShell, PageState, Pager, WorkspaceHeader } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb } from "../shell/workspaceNavigation";
import { FINDING_STATUS_LABELS, MODULE_LABELS, setResumeInspectionId } from "./model";

const pageSize = 20;

export function InspectionRecords({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const [offset, setOffset] = useState(0);
  const [room, setRoom] = useState("");
  const [status, setStatus] = useState("");
  const [sortKey, setSortKey] = useState("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState("");
  const query = useAnimalInspections({ limit: pageSize, offset, room, status, sortKey, sortDir });

  function sort(key: string) {
    if (key === sortKey) setSortDir((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const items = query.data?.items || [];
  const page = query.data?.page || { offset: 0, limit: pageSize, total: 0 };
  if (query.isLoading) return <PageState title="正在加载巡检记录..." />;
  if (query.isError) return <PageState title="巡检记录加载失败" retry={() => void query.refetch()} />;
  return (
    <section className="workspace-view animal-management-workspace">
      <WorkspaceHeader
        kicker="动物管理工作台"
        title="巡检记录"
        summary="查看本人记录和授权饲养间记录，支持按房间、状态和时间排序筛选。"
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
        actions={
          <button className="primary" type="button" onClick={() => navigate("animal-inspection-entry")}>
            新建巡检
          </button>
        }
      />
      <div className="workspace-body animal-management-body">
        <section className="panel inspection-list-panel">
          <div className="list-toolbar">
            <label>
              饲养间
              <select
                value={room}
                onChange={(event) => {
                  setRoom(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部饲养间</option>
                {(query.data?.filterOptions.rooms || []).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部状态</option>
                <option value="draft">草稿</option>
                <option value="submitted">已提交</option>
              </select>
            </label>
            <span className="list-meta">共 {page.total} 条</span>
          </div>
          <div className="table-scroll">
            <table className="dense-table inspection-table">
              <thead>
                <tr>
                  <SortableHeader label="饲养间" active={sortKey === "room"} onClick={() => sort("room")} />
                  <th>评估模块</th>
                  <SortableHeader label="状态" active={sortKey === "status"} onClick={() => sort("status")} />
                  <SortableHeader label="巡检人" active={sortKey === "creator"} onClick={() => sort("creator")} />
                  <SortableHeader label="更新时间" active={sortKey === "updatedAt"} onClick={() => sort("updatedAt")} />
                  <th>异常</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.roomName}</td>
                      <td>
                        {item.moduleCodes
                          .map((code) =>
                            code === "basicAssessment" ? "基础" : code === "advancedAssessment" ? "进阶" : "异常小鼠",
                          )
                          .join("、")}
                      </td>
                      <td>
                        <span className={`status-pill ${item.status}`}>
                          {item.status === "draft" ? "草稿" : "已提交"}
                        </span>
                      </td>
                      <td>{item.createdByName}</td>
                      <td>{formatDate(item.updatedAt)}</td>
                      <td>{item.findingSummary?.total || 0} 项</td>
                      <td className="row-actions">
                        <button className="secondary" type="button" onClick={() => setSelectedId(item.id)}>
                          详情
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => void downloadAnimalInspectionPdf(item.id)}
                        >
                          导出 PDF
                        </button>
                        {item.status === "draft" && item.createdBy === user.id ? (
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => {
                              setResumeInspectionId(item.id);
                              navigate("animal-inspection-entry");
                            }}
                          >
                            继续编辑
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <strong>暂无巡检记录</strong>
                        <span>选择饲养间并提交巡检后，记录会显示在这里。</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={Math.floor(page.offset / page.limit) + 1}
            pages={Math.max(1, Math.ceil(page.total / page.limit))}
            total={page.total}
            onPage={(nextPage) => setOffset((nextPage - 1) * page.limit)}
          />
        </section>
      </div>
      {selectedId ? <InspectionDetailDialog id={selectedId} onClose={() => setSelectedId("")} /> : null}
    </section>
  );
}

export function InspectionFindings({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<InspectionFinding | null>(null);
  const query = useAnimalFindings({ limit: pageSize, offset, status });
  const page = query.data?.page || { offset: 0, limit: pageSize, total: 0 };
  if (query.isLoading) return <PageState title="正在加载异常处置项..." />;
  if (query.isError) return <PageState title="异常处置项加载失败" retry={() => void query.refetch()} />;
  return (
    <section className="workspace-view animal-management-workspace">
      <WorkspaceHeader
        kicker="动物管理工作台"
        title="异常处置"
        summary="评分 1 分和 2 分自动进入处置队列，按待处理、处理中、待复查和已关闭闭环跟进。"
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
      />
      <div className="workspace-body animal-management-body">
        <section className="panel inspection-list-panel">
          <div className="list-toolbar">
            <label>
              处置状态
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部状态</option>
                {Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <span className="list-meta">共 {page.total} 项</span>
          </div>
          <div className="table-scroll">
            <table className="dense-table inspection-table">
              <thead>
                <tr>
                  <th>饲养间</th>
                  <th>异常项目</th>
                  <th>严重程度</th>
                  <th>位置/动物</th>
                  <th>状态</th>
                  <th>复查日期</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(query.data?.items || []).length ? (
                  query.data!.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.roomName}</td>
                      <td>{item.nodeCode}</td>
                      <td>
                        <span className={`severity-chip severity-${item.severity}`}>
                          {item.severity === 1 ? "严重 · 1 分" : "轻微 · 2 分"}
                        </span>
                      </td>
                      <td>
                        {[
                          item.rackHint && `笼架 ${item.rackHint}`,
                          item.cageNumber && `笼号 ${item.cageNumber}`,
                          item.locationHint,
                          item.animalIdentifier,
                        ]
                          .filter(Boolean)
                          .filter((value, index, values) => values.indexOf(value) === index)
                          .join(" / ") || "-"}
                      </td>
                      <td>
                        <span className={`status-pill ${item.status}`}>{FINDING_STATUS_LABELS[item.status]}</span>
                      </td>
                      <td>{item.recheckDueAt || "-"}</td>
                      <td>
                        <button className="secondary" type="button" onClick={() => setSelected(item)}>
                          处置
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-state">
                        <strong>当前没有异常处置项</strong>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={Math.floor(page.offset / page.limit) + 1}
            pages={Math.max(1, Math.ceil(page.total / page.limit))}
            total={page.total}
            onPage={(nextPage) => setOffset((nextPage - 1) * page.limit)}
          />
        </section>
      </div>
      {selected ? <FindingDialog finding={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function FindingDialog({ finding, onClose }: { finding: InspectionFinding; onClose: () => void }) {
  const [status, setStatus] = useState<FindingStatus>(finding.status);
  const [actionNote, setActionNote] = useState(finding.actionNote || "");
  const [responsibleName, setResponsibleName] = useState(finding.responsibleName || "");
  const [recheckDueAt, setRecheckDueAt] = useState(finding.recheckDueAt || "");
  const [conclusion, setConclusion] = useState("");
  const update = useUpdateFinding();
  const resolve = useResolveFinding();
  const [notice, setNotice] = useState("");
  async function save() {
    try {
      await update.mutateAsync({ id: finding.id, status, actionNote, responsibleName, recheckDueAt });
      setNotice("处置记录已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存处置失败");
    }
  }
  async function closeFinding() {
    try {
      await resolve.mutateAsync({ id: finding.id, conclusion });
      onClose();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "关闭异常失败");
    }
  }
  return (
    <ModalShell ariaLabel="异常处置" className="inspection-finding-dialog" onClose={onClose}>
      <div className="modal-head">
        <div>
          <span className="workspace-kicker">异常处置</span>
          <h2>{finding.nodeCode}</h2>
          <p>
            {finding.roomName} · {finding.severity === 1 ? "严重异常" : "轻微异常"}
          </p>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="modal-body">
        <label>
          处置状态
          <select value={status} onChange={(event) => setStatus(event.target.value as FindingStatus)}>
            {Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          实际措施
          <textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} />
        </label>
        <label>
          责任人
          <input value={responsibleName} onChange={(event) => setResponsibleName(event.target.value)} />
        </label>
        <label>
          复查日期
          <input type="date" value={recheckDueAt} onChange={(event) => setRecheckDueAt(event.target.value)} />
        </label>
        <label>
          关闭结论
          <textarea value={conclusion} onChange={(event) => setConclusion(event.target.value)} />
        </label>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        <p className="inspection-review-notice">医疗、安乐死与给药建议作为人工参考，处置前执行兽医与伦理审核。</p>
      </div>
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={() => void save()}>
          保存处置
        </button>
        <button className="danger" type="button" disabled={!conclusion.trim()} onClick={() => void closeFinding()}>
          确认关闭
        </button>
      </div>
    </ModalShell>
  );
}

function InspectionDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAnimalInspection(id);
  const scoreSummary = query.data ? summarizeInspectionScores(query.data.answers, query.data.catalog.nodes) : [];
  const abnormalScores = scoreSummary.flatMap((module) => module.items.filter((item) => item.score < 3));
  return (
    <ModalShell
      ariaLabel="巡检记录详情"
      className="inspection-finding-dialog inspection-detail-dialog"
      onClose={onClose}
    >
      <div className="modal-head">
        <div>
          <span className="workspace-kicker">巡检记录详情</span>
          <h2>{query.data?.item.roomName || "正在加载"}</h2>
          <p>
            {query.data?.item.createdByName || ""} ·{" "}
            {formatDate(query.data?.item.submittedAt || query.data?.item.updatedAt || "")}
          </p>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      {query.isLoading ? (
        <div className="modal-body">
          <p>正在加载评分与处置记录...</p>
        </div>
      ) : query.isError || !query.data ? (
        <div className="modal-body">
          <p role="alert">巡检记录详情加载失败。</p>
        </div>
      ) : (
        <div className="modal-body">
          <section className="inspection-detail-summary">
            <strong>房间快照</strong>
            <span>IACUC：{query.data.item.snapshot.iacucs.join("、") || "-"}</span>
            <span>项目负责人：{query.data.item.snapshot.pis.join("、") || "-"}</span>
            <span>品系：{query.data.item.snapshot.species.join("、") || "-"}</span>
            <span>动物数量：{query.data.item.snapshot.animalCount}</span>
          </section>
          <section className="inspection-detail-scores">
            <div className="inspection-detail-section-head">
              <h3>评分概览</h3>
              <span>共 {query.data.answers.length} 项</span>
            </div>
            <div className="inspection-detail-score-grid">
              {scoreSummary.map((module) => (
                <article key={module.code}>
                  <strong>{MODULE_LABELS[module.code]}</strong>
                  <span>{module.items.length} 项标准</span>
                  <div className="inspection-detail-score-counts" aria-label={`${MODULE_LABELS[module.code]}评分分布`}>
                    <span className="score-3">3 分 {module.counts[3]}</span>
                    <span className="score-2">2 分 {module.counts[2]}</span>
                    <span className="score-1">1 分 {module.counts[1]}</span>
                  </div>
                </article>
              ))}
            </div>
            {abnormalScores.length ? (
              <details className="inspection-detail-exception-scores">
                <summary>查看 {abnormalScores.length} 项异常评分</summary>
                <ul>
                  {abnormalScores.map((item) => (
                    <li key={`${item.moduleCode}-${item.nodeCode}`}>
                      <span>{MODULE_LABELS[item.moduleCode]}</span>
                      <strong>{item.name}</strong>
                      <em className={item.score === 1 ? "score-1" : "score-2"}>{item.score} 分</em>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="inspection-detail-all-normal">本次评分均为 3 分。</p>
            )}
          </section>
          <section>
            <h3>异常与处置</h3>
            {query.data.findings.length ? (
              <ul className="inspection-detail-findings">
                {query.data.findings.map((finding) => (
                  <li key={finding.id}>
                    <strong>{finding.nodeCode}</strong>
                    <span>
                      {FINDING_STATUS_LABELS[finding.status]} · {finding.actionNote || "待补充处置措施"}
                    </span>
                    {finding.attachments.length ? <span>{finding.attachments.length} 张照片证据</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>本次巡检未生成异常处置项。</p>
            )}
          </section>
        </div>
      )}
      <div className="modal-actions">
        <button className="secondary" type="button" onClick={() => void downloadAnimalInspectionPdf(id)}>
          导出 PDF
        </button>
      </div>
    </ModalShell>
  );
}

function summarizeInspectionScores(
  answers: AnimalInspectionDetail["answers"],
  nodes: InspectionCatalogNode[],
): Array<{
  code: InspectionModuleCode;
  counts: Record<1 | 2 | 3, number>;
  items: Array<{ moduleCode: InspectionModuleCode; nodeCode: string; name: string; score: 1 | 2 | 3 }>;
}> {
  const nodeByKey = new Map(nodes.map((node) => [`${node.moduleCode}:${node.code}`, node]));
  const records = answers.map((answer) => {
    const source = answer.payload || answer;
    const moduleCode = source.moduleCode || answer.module_code;
    const nodeCode = source.nodeCode || answer.node_code;
    const node = nodeByKey.get(`${moduleCode}:${nodeCode}`);
    return {
      moduleCode,
      nodeCode,
      name: node?.name || nodeCode,
      score: source.score || answer.score,
    };
  });
  return (Object.keys(MODULE_LABELS) as InspectionModuleCode[])
    .map((code) => {
      const items = records.filter((item) => item.moduleCode === code);
      return {
        code,
        counts: {
          1: items.filter((item) => item.score === 1).length,
          2: items.filter((item) => item.score === 2).length,
          3: items.filter((item) => item.score === 3).length,
        },
        items,
      };
    })
    .filter((module) => module.items.length);
}

function SortableHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th>
      <button className={`table-sort-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
        {label}
      </button>
    </th>
  );
}

function formatDate(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "-";
}
