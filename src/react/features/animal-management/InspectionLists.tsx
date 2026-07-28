import { useState } from "react";
import { Button, Descriptions, Empty, Form, Input, Select, Space, Table, Tag, Typography } from "antd";

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
import { ActionButton } from "../../components/ui/ActionButton";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb } from "../shell/workspaceNavigation";
import { FINDING_STATUS_LABELS, inspectionOutcome, MODULE_LABELS, setResumeInspectionId } from "./model";

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
          <ActionButton tone="primary" onClick={() => navigate("animal-inspection-entry")}>
            新建巡检
          </ActionButton>
        }
      />
      <div className="workspace-body animal-management-body">
        <section className="panel inspection-list-panel">
          <div className="list-toolbar antd-list-toolbar">
            <Form component={false} layout="inline">
              <Form.Item label="饲养间">
                <Select
                  allowClear
                  className="min-select-control"
                  options={(query.data?.filterOptions.rooms || []).map((item) => ({ label: item, value: item }))}
                  placeholder="全部饲养间"
                  value={room || undefined}
                  onChange={(value) => {
                    setRoom(value || "");
                    setOffset(0);
                  }}
                />
              </Form.Item>
              <Form.Item label="状态">
                <Select
                  allowClear
                  className="min-select-control"
                  options={[
                    { label: "草稿", value: "draft" },
                    { label: "已提交", value: "submitted" },
                  ]}
                  placeholder="全部状态"
                  value={status || undefined}
                  onChange={(value) => {
                    setStatus(value || "");
                    setOffset(0);
                  }}
                />
              </Form.Item>
            </Form>
            <Tag variant="filled">共 {page.total} 条</Tag>
          </div>
          <Table
            className="antd-data-table inspection-table"
            columns={[
              sortableColumn("饲养间", "room", sortKey, sort, (item) => item.roomName),
              {
                title: "评估模块",
                dataIndex: "moduleCodes",
                render: (codes: InspectionModuleCode[]) => codes.map(moduleLabel).join("、"),
              },
              sortableColumn("状态", "status", sortKey, sort, (item) => (
                <Tag color={item.status === "draft" ? "gold" : "green"}>
                  {item.status === "draft" ? "草稿" : "已提交"}
                </Tag>
              )),
              sortableColumn("巡检人", "creator", sortKey, sort, (item) => item.createdByName),
              sortableColumn("更新时间", "updatedAt", sortKey, sort, (item) => formatDate(item.updatedAt)),
              { title: "异常", render: (_, item) => `${item.findingSummary?.total || 0} 项` },
              {
                title: "操作",
                fixed: "right",
                render: (_, item) => (
                  <Space size={4} wrap>
                    <Button size="small" onClick={() => setSelectedId(item.id)}>
                      详情
                    </Button>
                    <Button size="small" onClick={() => void downloadAnimalInspectionPdf(item.id)}>
                      导出 PDF
                    </Button>
                    {item.status === "draft" && item.createdBy === user.id ? (
                      <Button
                        size="small"
                        onClick={() => {
                          setResumeInspectionId(item.id);
                          navigate("animal-inspection-entry");
                        }}
                      >
                        继续编辑
                      </Button>
                    ) : null}
                  </Space>
                ),
              },
            ]}
            dataSource={items}
            locale={{ emptyText: <Empty description="暂无巡检记录" /> }}
            pagination={false}
            rowKey="id"
            scroll={{ x: 920 }}
            size="middle"
          />
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
        summary="已登记异常自动进入处置队列，按待处理、处理中、待复查和已关闭闭环跟进。"
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
      />
      <div className="workspace-body animal-management-body">
        <section className="panel inspection-list-panel">
          <div className="list-toolbar antd-list-toolbar">
            <Form component={false} layout="inline">
              <Form.Item label="处置状态">
                <Select
                  allowClear
                  className="min-select-control"
                  options={Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => ({ label, value }))}
                  placeholder="全部状态"
                  value={status || undefined}
                  onChange={(value) => {
                    setStatus(value || "");
                    setOffset(0);
                  }}
                />
              </Form.Item>
            </Form>
            <Tag variant="filled">共 {page.total} 项</Tag>
          </div>
          <Table
            className="antd-data-table inspection-table"
            columns={[
              { title: "饲养间", dataIndex: "roomName" },
              { title: "异常项目", dataIndex: "nodeCode" },
              { title: "位置/动物", render: (_, item) => findingLocation(item) },
              {
                title: "状态",
                render: (_, item) => (
                  <Tag color={findingStatusColor(item.status)}>{FINDING_STATUS_LABELS[item.status]}</Tag>
                ),
              },
              { title: "复查日期", dataIndex: "recheckDueAt", render: (value: string | undefined) => value || "-" },
              {
                title: "操作",
                fixed: "right",
                render: (_, item) => (
                  <Button size="small" onClick={() => setSelected(item)}>
                    处置
                  </Button>
                ),
              },
            ]}
            dataSource={query.data?.items || []}
            locale={{ emptyText: <Empty description="当前没有异常处置项" /> }}
            pagination={false}
            rowKey="id"
            scroll={{ x: 760 }}
          />
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
          <p>{finding.roomName} · 已登记异常</p>
        </div>
        <Button size="small" onClick={onClose}>
          关闭
        </Button>
      </div>
      <div className="modal-body">
        <Form layout="vertical">
          <Form.Item label="处置状态">
            <Select<FindingStatus>
              options={Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => ({
                label,
                value: value as FindingStatus,
              }))}
              value={status}
              onChange={setStatus}
            />
          </Form.Item>
          <Form.Item label="实际措施">
            <Input.TextArea value={actionNote} onChange={(event) => setActionNote(event.target.value)} />
          </Form.Item>
          <Form.Item label="责任人">
            <Input value={responsibleName} onChange={(event) => setResponsibleName(event.target.value)} />
          </Form.Item>
          <Form.Item label="复查日期">
            <Input type="date" value={recheckDueAt} onChange={(event) => setRecheckDueAt(event.target.value)} />
          </Form.Item>
          <Form.Item label="关闭结论">
            <Input.TextArea value={conclusion} onChange={(event) => setConclusion(event.target.value)} />
          </Form.Item>
        </Form>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        <p className="inspection-review-notice">医疗、安乐死与给药建议作为人工参考，处置前执行兽医与伦理审核。</p>
      </div>
      <div className="modal-actions">
        <Button loading={update.isPending} onClick={() => void save()}>
          保存处置
        </Button>
        <Button
          danger
          disabled={!conclusion.trim()}
          loading={resolve.isPending}
          type="primary"
          onClick={() => void closeFinding()}
        >
          确认关闭
        </Button>
      </div>
    </ModalShell>
  );
}

function InspectionDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAnimalInspection(id);
  const outcomeSummary = query.data ? summarizeInspectionOutcomes(query.data.answers, query.data.catalog.nodes) : [];
  const abnormalities = outcomeSummary.flatMap((module) => module.items.filter((item) => item.outcome === "abnormal"));
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
        <Button size="small" onClick={onClose}>
          关闭
        </Button>
      </div>
      {query.isLoading ? (
        <div className="modal-body">
          <p>正在加载巡检结论与处置记录...</p>
        </div>
      ) : query.isError || !query.data ? (
        <div className="modal-body">
          <p role="alert">巡检记录详情加载失败。</p>
        </div>
      ) : (
        <div className="modal-body">
          <section className="inspection-detail-summary">
            <Typography.Title level={5}>房间快照</Typography.Title>
            <Descriptions column={{ xs: 1, sm: 2 }} size="small">
              <Descriptions.Item label="IACUC">{query.data.item.snapshot.iacucs.join("、") || "-"}</Descriptions.Item>
              <Descriptions.Item label="项目负责人">{query.data.item.snapshot.pis.join("、") || "-"}</Descriptions.Item>
              <Descriptions.Item label="品系">{query.data.item.snapshot.species.join("、") || "-"}</Descriptions.Item>
              <Descriptions.Item label="动物数量">{query.data.item.snapshot.animalCount}</Descriptions.Item>
            </Descriptions>
          </section>
          <section className="inspection-detail-scores">
            <div className="inspection-detail-section-head">
              <h3>巡检结论概览</h3>
              <span>共 {query.data.answers.length} 项</span>
            </div>
            <div className="inspection-detail-score-grid">
              {outcomeSummary.map((module) => (
                <article key={module.code}>
                  <strong>{MODULE_LABELS[module.code]}</strong>
                  <span>{module.items.length} 项标准</span>
                  <div
                    className="inspection-detail-score-counts"
                    aria-label={`${MODULE_LABELS[module.code]}巡检结论分布`}
                  >
                    <span className="outcome-normal">正常 {module.counts.normal}</span>
                    <span className="outcome-abnormal">异常 {module.counts.abnormal}</span>
                  </div>
                </article>
              ))}
            </div>
            {abnormalities.length ? (
              <details className="inspection-detail-exception-scores">
                <summary>查看 {abnormalities.length} 项异常登记</summary>
                <ul>
                  {abnormalities.map((item) => (
                    <li key={`${item.moduleCode}-${item.nodeCode}`}>
                      <span>{MODULE_LABELS[item.moduleCode]}</span>
                      <strong>{item.name}</strong>
                      <em className="outcome-abnormal">异常</em>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="inspection-detail-all-normal">本次巡检均已确认正常。</p>
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
        <Button onClick={() => void downloadAnimalInspectionPdf(id)}>导出 PDF</Button>
      </div>
    </ModalShell>
  );
}

function summarizeInspectionOutcomes(
  answers: AnimalInspectionDetail["answers"],
  nodes: InspectionCatalogNode[],
): Array<{
  code: InspectionModuleCode;
  counts: Record<"normal" | "abnormal", number>;
  items: Array<{ moduleCode: InspectionModuleCode; nodeCode: string; name: string; outcome: "normal" | "abnormal" }>;
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
      outcome: inspectionOutcome(source),
    };
  });
  return (Object.keys(MODULE_LABELS) as InspectionModuleCode[])
    .map((code) => {
      const items = records.filter((item) => item.moduleCode === code);
      return {
        code,
        counts: {
          normal: items.filter((item) => item.outcome === "normal").length,
          abnormal: items.filter((item) => item.outcome === "abnormal").length,
        },
        items,
      };
    })
    .filter((module) => module.items.length);
}

function sortableColumn<T extends { roomName: string; status: string; createdByName: string; updatedAt: string }>(
  label: string,
  key: string,
  activeKey: string,
  onSort: (key: string) => void,
  render: (item: T) => React.ReactNode,
) {
  return {
    title: (
      <Button type={activeKey === key ? "link" : "text"} onClick={() => onSort(key)}>
        {label}
      </Button>
    ),
    render: (_: unknown, item: T) => render(item),
  };
}

function moduleLabel(code: InspectionModuleCode) {
  return code === "basicAssessment" ? "基础" : code === "advancedAssessment" ? "进阶" : "异常小鼠";
}

function findingLocation(item: InspectionFinding) {
  return (
    [
      item.rackHint && `笼架 ${item.rackHint}`,
      item.cageNumber && `笼号 ${item.cageNumber}`,
      item.locationHint,
      item.animalIdentifier,
    ]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" / ") || "-"
  );
}

function findingStatusColor(status: FindingStatus) {
  return status === "resolved" ? "green" : status === "pending" ? "gold" : "blue";
}

function formatDate(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "-";
}
