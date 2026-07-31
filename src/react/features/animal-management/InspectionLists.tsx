import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";

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
import { PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
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

  const items = query.data?.items || [];
  const page = query.data?.page || { offset: 0, limit: pageSize, total: 0 };
  const current = Math.floor(page.offset / page.limit) + 1;

  function updateSort(key: string, direction?: "asc" | "desc") {
    setSortKey(key);
    setSortDir(direction || (key === sortKey && sortDir === "asc" ? "desc" : "asc"));
    setOffset(0);
  }

  if (query.isLoading) return <PageState title="正在加载巡检记录..." />;
  if (query.isError) return <PageState title="巡检记录加载失败" retry={() => void query.refetch()} />;
  return (
    <section className="workspace-view animal-management-workspace">
      <WorkspaceHeader
        kicker="动物管理"
        title="巡检记录"
        summary="查看本人记录和授权饲养间记录。"
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
        actions={
          <ActionButton tone="primary" onClick={() => navigate("animal-inspection-entry")}>
            新建巡检
          </ActionButton>
        }
      />
      <div className="workspace-body animal-management-body">
        <Card
          className="animal-ant-card inspection-list-panel"
          extra={<Tag color="blue">共 {page.total} 条</Tag>}
          title="巡检记录"
        >
          <Form className="inspection-list-filters" component={false} layout="inline">
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
          <Table
            className="inspection-table"
            columns={[
              { title: "饲养间", dataIndex: "roomName", key: "room", sorter: true },
              {
                title: "评估模块",
                dataIndex: "moduleCodes",
                render: (codes: InspectionModuleCode[]) => codes.map(moduleLabel).join("、"),
              },
              {
                title: "状态",
                dataIndex: "status",
                key: "status",
                sorter: true,
                render: (value: string) => (
                  <Tag color={value === "draft" ? "gold" : "green"}>{value === "draft" ? "草稿" : "已提交"}</Tag>
                ),
              },
              { title: "巡检人", dataIndex: "createdByName", key: "creator", sorter: true },
              { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt", sorter: true, render: formatDate },
              { title: "异常", render: (_, item) => `${item.findingSummary?.total || 0} 项` },
              {
                title: "操作",
                fixed: "right",
                render: (_, item) => (
                  <Space size={0} split={<span className="ant-space-split">|</span>}>
                    <Button size="small" type="link" onClick={() => setSelectedId(item.id)}>
                      详情
                    </Button>
                    <Button size="small" type="link" onClick={() => void downloadAnimalInspectionPdf(item.id)}>
                      导出 PDF
                    </Button>
                    {item.status === "draft" && item.createdBy === user.id ? (
                      <Button
                        size="small"
                        type="link"
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
            pagination={{
              current,
              pageSize: page.limit,
              showQuickJumper: page.total > page.limit * 5,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
              total: page.total,
              onChange: (next) => setOffset((next - 1) * page.limit),
            }}
            rowKey="id"
            scroll={{ x: 920 }}
            onChange={(_, __, sorter) => {
              const result = Array.isArray(sorter) ? sorter[0] : sorter;
              const key = String(result?.columnKey || "");
              if (key && result?.order) updateSort(key, result.order === "ascend" ? "asc" : "desc");
            }}
          />
        </Card>
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
  const current = Math.floor(page.offset / page.limit) + 1;
  if (query.isLoading) return <PageState title="正在加载异常处置项..." />;
  if (query.isError) return <PageState title="异常处置项加载失败" retry={() => void query.refetch()} />;
  return (
    <section className="workspace-view animal-management-workspace">
      <WorkspaceHeader
        kicker="动物管理"
        title="异常处置"
        summary="异常登记进入处置队列，按待处理、处理中、待复查和已关闭闭环跟进。"
        breadcrumbs={[breadcrumb("动物管理", () => navigate("animal-inspection-entry"))]}
      />
      <div className="workspace-body animal-management-body">
        <Card
          className="animal-ant-card inspection-list-panel"
          extra={<Tag color="orange">共 {page.total} 项</Tag>}
          title="异常处置队列"
        >
          <Form className="inspection-list-filters" component={false} layout="inline">
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
          <Table
            className="inspection-table"
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
                  <Button size="small" type="link" onClick={() => setSelected(item)}>
                    处置
                  </Button>
                ),
              },
            ]}
            dataSource={query.data?.items || []}
            locale={{ emptyText: <Empty description="当前没有异常处置项" /> }}
            pagination={{
              current,
              pageSize: page.limit,
              showQuickJumper: page.total > page.limit * 5,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
              total: page.total,
              onChange: (next) => setOffset((next - 1) * page.limit),
            }}
            rowKey="id"
            scroll={{ x: 760 }}
          />
        </Card>
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
    <Modal
      cancelText="取消"
      className="inspection-action-modal"
      destroyOnHidden
      okButtonProps={{ loading: update.isPending }}
      okText="保存处置"
      onCancel={onClose}
      onOk={() => void save()}
      open
      title="异常处置"
      width={720}
      footer={(_, { CancelBtn, OkBtn }) => (
        <Space>
          <CancelBtn />
          <OkBtn />
          <Button
            danger
            disabled={!conclusion.trim()}
            loading={resolve.isPending}
            type="primary"
            onClick={() => void closeFinding()}
          >
            确认关闭
          </Button>
        </Space>
      )}
    >
      <Descriptions className="inspection-finding-summary" column={{ xs: 1, sm: 2 }} size="small">
        <Descriptions.Item label="饲养间">{finding.roomName}</Descriptions.Item>
        <Descriptions.Item label="异常项目">{finding.nodeCode}</Descriptions.Item>
        <Descriptions.Item label="定位信息" span={2}>
          {findingLocation(finding)}
        </Descriptions.Item>
      </Descriptions>
      <Form className="inspection-action-form" layout="vertical">
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
          <Input.TextArea rows={3} value={actionNote} onChange={(event) => setActionNote(event.target.value)} />
        </Form.Item>
        <div className="inspection-action-fields">
          <Form.Item label="责任人">
            <Input value={responsibleName} onChange={(event) => setResponsibleName(event.target.value)} />
          </Form.Item>
          <Form.Item label="复查日期">
            <Input type="date" value={recheckDueAt} onChange={(event) => setRecheckDueAt(event.target.value)} />
          </Form.Item>
        </div>
        <Form.Item label="关闭结论">
          <Input.TextArea rows={3} value={conclusion} onChange={(event) => setConclusion(event.target.value)} />
        </Form.Item>
      </Form>
      {notice ? <Alert message={notice} showIcon type="info" /> : null}
      <Alert
        className="inspection-action-note"
        description="医疗、安乐死与给药建议作为人工参考，处置前执行兽医与伦理审核。"
        showIcon
        type="warning"
      />
    </Modal>
  );
}

function InspectionDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAnimalInspection(id);
  const outcomeSummary = query.data ? summarizeInspectionOutcomes(query.data.answers, query.data.catalog.nodes) : [];
  const abnormalities = outcomeSummary.flatMap((module) => module.items.filter((item) => item.outcome === "abnormal"));
  return (
    <Modal
      className="inspection-detail-modal"
      destroyOnHidden
      footer={<Button onClick={() => void downloadAnimalInspectionPdf(id)}>导出 PDF</Button>}
      onCancel={onClose}
      open
      title="巡检记录详情"
      width={860}
    >
      {query.isLoading ? <Typography.Text>正在加载巡检结论与处置记录...</Typography.Text> : null}
      {query.isError || !query.data ? <Alert message="巡检记录详情加载失败" showIcon type="error" /> : null}
      {query.data ? (
        <Space className="inspection-detail-content" direction="vertical" size={16} style={{ width: "100%" }}>
          <Descriptions bordered column={{ xs: 1, sm: 2 }} size="small" title={query.data.item.roomName}>
            <Descriptions.Item label="巡检人">{query.data.item.createdByName}</Descriptions.Item>
            <Descriptions.Item label="提交时间">
              {formatDate(query.data.item.submittedAt || query.data.item.updatedAt)}
            </Descriptions.Item>
            <Descriptions.Item label="IACUC">{query.data.item.snapshot.iacucs.join("、") || "-"}</Descriptions.Item>
            <Descriptions.Item label="项目负责人">{query.data.item.snapshot.pis.join("、") || "-"}</Descriptions.Item>
            <Descriptions.Item label="品系">{query.data.item.snapshot.species.join("、") || "-"}</Descriptions.Item>
            <Descriptions.Item label="动物数量">{query.data.item.snapshot.animalCount}</Descriptions.Item>
          </Descriptions>
          <Card size="small" title="巡检结论概览">
            <List
              dataSource={outcomeSummary}
              renderItem={(module) => (
                <List.Item>
                  <Space wrap>
                    <Typography.Text strong>{MODULE_LABELS[module.code]}</Typography.Text>
                    <Tag>{module.items.length} 项标准</Tag>
                    <Tag color="green">正常 {module.counts.normal}</Tag>
                    <Tag color="red">异常 {module.counts.abnormal}</Tag>
                  </Space>
                </List.Item>
              )}
            />
            {abnormalities.length ? (
              <Collapse
                items={[
                  {
                    key: "abnormalities",
                    label: `查看 ${abnormalities.length} 项异常登记`,
                    children: (
                      <List
                        dataSource={abnormalities}
                        renderItem={(item) => (
                          <List.Item>
                            <Space wrap>
                              <Tag>{MODULE_LABELS[item.moduleCode]}</Tag>
                              <Typography.Text>{item.name}</Typography.Text>
                              <Tag color="red">异常</Tag>
                            </Space>
                          </List.Item>
                        )}
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <Alert message="本次巡检均已确认正常。" showIcon type="success" />
            )}
          </Card>
          <Card size="small" title="异常与处置">
            {query.data.findings.length ? (
              <List
                dataSource={query.data.findings}
                renderItem={(finding) => (
                  <List.Item>
                    <List.Item.Meta
                      description={`${FINDING_STATUS_LABELS[finding.status]} · ${finding.actionNote || "待补充处置措施"}`}
                      title={finding.nodeCode}
                    />
                    {finding.attachments.length ? <Tag>{finding.attachments.length} 张照片</Tag> : null}
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="本次巡检未生成异常处置项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Space>
      ) : null}
    </Modal>
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
    return { moduleCode, nodeCode, name: node?.name || nodeCode, outcome: inspectionOutcome(source) };
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
