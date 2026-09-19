import { useState } from "react";
import { List as MobileList } from "antd-mobile";
import { Alert, Button, Card, Collapse, Descriptions, Empty, Form, Modal, Select, Space, Tag, Typography } from "antd";

import type { FindingStatus, InspectionFinding, InspectionModuleCode, SessionUser } from "../../api/contracts";
import {
  downloadAnimalInspectionPdf,
  useAnimalFindings,
  useAnimalInspection,
  useAnimalInspections,
} from "../../api/animalManagement";
import { PageSkeleton, PageState, Pager, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ActionButton } from "../../components/ui/ActionButton";
import { MobilePage } from "../../components/ui/MobilePage";
import { DataTable, ListRefreshStatus } from "../../components/ui";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import type { WorkspaceView } from "../../state/ui";
import { FindingDialog } from "./InspectionFindingDialog";
import {
  FINDING_STATUS_LABELS,
  findingLocation,
  summarizeInspectionOutcomes,
  MODULE_LABELS,
  setResumeInspectionId,
} from "./model";

const pageSize = 10;

export function InspectionRecords({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
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

  if (query.isPending) return <PageSkeleton label="巡检记录" variant="table" />;
  if (query.isError && !query.data) return <PageState title="巡检记录加载失败" retry={() => void query.refetch()} />;
  const feedback = (
    <InspectionListFeedback error={query.isError} refreshing={query.isFetching} retry={() => void query.refetch()} />
  );
  const filters = (
    <Form className="inspection-list-filters" component="div" layout={isMobile ? "vertical" : "inline"}>
      <Form.Item label="饲养间">
        <Select
          allowClear
          className="min-select-control"
          options={(query.data?.filterOptions.rooms || []).map((item) => ({ label: item, value: item }))}
          placeholder="全部饲养间"
          style={isMobile ? { width: "100%" } : undefined}
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
          style={isMobile ? { width: "100%" } : undefined}
          value={status || undefined}
          onChange={(value) => {
            setStatus(value || "");
            setOffset(0);
          }}
        />
      </Form.Item>
    </Form>
  );
  if (isMobile) {
    return (
      <>
        <MobilePage onBack={() => navigate("animal-inspection-entry")} title="巡检记录">
          <WorkspaceToolbar
            ariaLabel="巡检记录操作"
            filters={filters}
            primaryAction={
              <ActionButton tone="primary" onClick={() => navigate("animal-inspection-entry")}>
                新建巡检
              </ActionButton>
            }
          />
          {feedback}
          <Card className="animal-ant-card inspection-list-panel">
            {items.length ? (
              <MobileList>
                {items.map((item) => (
                  <MobileList.Item
                    description={`${item.status === "draft" ? "草稿" : "已提交"} · ${item.createdByName} · ${formatDate(item.updatedAt)}`}
                    extra={`${item.findingSummary?.total || 0} 项异常`}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {item.roomName} · {item.moduleCodes.map(moduleLabel).join("、")}
                  </MobileList.Item>
                ))}
              </MobileList>
            ) : (
              <Empty description="暂无巡检记录" />
            )}
            <Pager
              onPage={(next) => setOffset((next - 1) * page.limit)}
              page={current}
              pageSize={page.limit}
              pages={Math.max(Math.ceil(page.total / page.limit), 1)}
              total={page.total}
            />
          </Card>
        </MobilePage>
        {selectedId ? <InspectionDetailDialog id={selectedId} onClose={() => setSelectedId("")} /> : null}
      </>
    );
  }
  return (
    <>
      <MobilePage
        title="巡检记录"
        onBack={() => navigate("animal-inspection-entry")}
        desktop={{
          className: "workspace-view animal-management-workspace",
          bodyClassName: "workspace-body animal-management-body",
          feature: "animal-management",
        }}
      >
        <WorkspaceToolbar
          ariaLabel="巡检记录操作"
          filters={filters}
          primaryAction={
            <ActionButton tone="primary" onClick={() => navigate("animal-inspection-entry")}>
              新建巡检
            </ActionButton>
          }
        />

        {feedback}
        <Card className="animal-ant-card inspection-list-panel" title="巡检记录">
          <DataTable
            className="inspection-table"
            resizeKey="inspection-records"
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
                width: 256,
                render: (_, item) => (
                  <Space size={4}>
                    <Button onClick={() => setSelectedId(item.id)}>详情</Button>
                    <Button onClick={() => void downloadAnimalInspectionPdf(item.id)}>导出 PDF</Button>
                    {item.status === "draft" && item.createdBy === user.id ? (
                      <Button
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
            onChange={(_, __, sorter) => {
              const result = Array.isArray(sorter) ? sorter[0] : sorter;
              const key = String(result?.columnKey || "");
              if (key && result?.order) updateSort(key, result.order === "ascend" ? "asc" : "desc");
            }}
          />
          <Pager
            onPage={(next) => setOffset((next - 1) * page.limit)}
            page={current}
            pageSize={page.limit}
            pages={Math.max(Math.ceil(page.total / page.limit), 1)}
            total={page.total}
          />
        </Card>
      </MobilePage>
      {selectedId ? <InspectionDetailDialog id={selectedId} onClose={() => setSelectedId("")} /> : null}
    </>
  );
}

export function InspectionFindings({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<InspectionFinding | null>(null);
  const query = useAnimalFindings({ limit: pageSize, offset, status });
  const page = query.data?.page || { offset: 0, limit: pageSize, total: 0 };
  const current = Math.floor(page.offset / page.limit) + 1;
  if (query.isPending) return <PageSkeleton label="异常处置项" variant="table" />;
  if (query.isError && !query.data) return <PageState title="异常处置项加载失败" retry={() => void query.refetch()} />;
  const feedback = (
    <InspectionListFeedback error={query.isError} refreshing={query.isFetching} retry={() => void query.refetch()} />
  );
  const filters = (
    <Form className="inspection-list-filters" component="div" layout={isMobile ? "vertical" : "inline"}>
      <Form.Item label="处置状态">
        <Select
          allowClear
          className="min-select-control"
          options={Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => ({ label, value }))}
          placeholder="全部状态"
          style={isMobile ? { width: "100%" } : undefined}
          value={status || undefined}
          onChange={(value) => {
            setStatus(value || "");
            setOffset(0);
          }}
        />
      </Form.Item>
    </Form>
  );
  if (isMobile) {
    const findings = query.data?.items || [];
    return (
      <>
        <MobilePage onBack={() => navigate("animal-inspection-entry")} title="异常处置">
          <WorkspaceToolbar ariaLabel="异常处置" filters={filters} />
          {feedback}
          <Card className="animal-ant-card inspection-list-panel">
            {findings.length ? (
              <MobileList>
                {findings.map((item) => (
                  <MobileList.Item
                    description={`${findingLocation(item)} · ${FINDING_STATUS_LABELS[item.status]}`}
                    key={item.id}
                    onClick={() => setSelected(item)}
                  >
                    {item.roomName} · {item.nodeCode}
                  </MobileList.Item>
                ))}
              </MobileList>
            ) : (
              <Empty description="当前没有异常处置项" />
            )}
            <Pager
              onPage={(next) => setOffset((next - 1) * page.limit)}
              page={current}
              pageSize={page.limit}
              pages={Math.max(Math.ceil(page.total / page.limit), 1)}
              total={page.total}
            />
          </Card>
        </MobilePage>
        {selected ? <FindingDialog finding={selected} onClose={() => setSelected(null)} /> : null}
      </>
    );
  }
  return (
    <>
      <MobilePage
        title="异常处置"
        onBack={() => navigate("animal-inspection-entry")}
        desktop={{
          className: "workspace-view animal-management-workspace",
          bodyClassName: "workspace-body animal-management-body",
          feature: "animal-management",
        }}
      >
        <WorkspaceToolbar ariaLabel="异常处置" filters={filters} />
        {feedback}
        <Card className="animal-ant-card inspection-list-panel" title="异常处置队列">
          <DataTable
            className="inspection-table"
            resizeKey="inspection-findings"
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
                width: 96,
                render: (_, item) => (
                  <Button type="primary" onClick={() => setSelected(item)}>
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
            onPage={(next) => setOffset((next - 1) * page.limit)}
            page={current}
            pageSize={page.limit}
            pages={Math.max(Math.ceil(page.total / page.limit), 1)}
            total={page.total}
          />
        </Card>
      </MobilePage>
      {selected ? <FindingDialog finding={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function InspectionListFeedback({
  error,
  refreshing,
  retry,
}: {
  error: boolean;
  refreshing: boolean;
  retry: () => void;
}) {
  return (
    <>
      <ListRefreshStatus active={refreshing} />
      {error ? (
        <Alert
          role="alert"
          title="巡检信息更新失败，暂显示上次结果"
          showIcon
          type="error"
          action={
            <Button loading={refreshing} onClick={retry}>
              重试
            </Button>
          }
        />
      ) : null}
    </>
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
      {query.isPending ? <PageSkeleton compact label="巡检结论与处置记录" rows={4} variant="detail" /> : null}
      {query.isError || (query.isSuccess && !query.data) ? (
        <Alert
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
          title="巡检记录详情加载失败"
          showIcon
          type="error"
        />
      ) : null}
      {query.data ? (
        <Space className="inspection-detail-content" orientation="vertical" size={16} style={{ width: "100%" }}>
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
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              {outcomeSummary.map((module) => (
                <Space key={module.code} wrap>
                  <Typography.Text strong>{MODULE_LABELS[module.code]}</Typography.Text>
                  <Tag>{module.items.length} 项标准</Tag>
                  <Tag color="green">正常 {module.counts.normal}</Tag>
                  <Tag color="red">异常 {module.counts.abnormal}</Tag>
                </Space>
              ))}
            </Space>
            {abnormalities.length ? (
              <Collapse
                items={[
                  {
                    key: "abnormalities",
                    label: `查看 ${abnormalities.length} 项异常登记`,
                    children: (
                      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                        {abnormalities.map((item) => (
                          <Space key={`${item.moduleCode}:${item.name}`} wrap>
                            <Tag>{MODULE_LABELS[item.moduleCode]}</Tag>
                            <Typography.Text>{item.name}</Typography.Text>
                            <Tag color="red">异常</Tag>
                          </Space>
                        ))}
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              <Alert title="本次巡检均已确认正常。" showIcon type="success" />
            )}
          </Card>
          <Card size="small" title="异常与处置">
            {query.data.findings.length ? (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                {query.data.findings.map((finding) => (
                  <div key={finding.nodeCode} className="inspection-finding-row">
                    <div>
                      <Typography.Text strong>{finding.nodeCode}</Typography.Text>
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                        {FINDING_STATUS_LABELS[finding.status]} · {finding.actionNote || "待补充处置措施"}
                      </Typography.Paragraph>
                    </div>
                    {finding.attachments.length ? <Tag>{finding.attachments.length} 张照片</Tag> : null}
                  </div>
                ))}
              </Space>
            ) : (
              <Empty description="本次巡检未生成异常处置项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Space>
      ) : null}
    </Modal>
  );
}

function moduleLabel(code: InspectionModuleCode) {
  return code === "basicAssessment" ? "基础" : code === "advancedAssessment" ? "进阶" : "异常小鼠";
}

function findingStatusColor(status: FindingStatus) {
  return status === "resolved" ? "green" : status === "pending" ? "gold" : "blue";
}

function formatDate(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "-";
}
