import { ActionIcon } from "../../components/ui/ActionIcon";
import { useState } from "react";
import { List as MobileList } from "antd-mobile";
import { Button, Card, Empty, Form, Select, Tag } from "antd";
import type { InspectionModuleCode, SessionUser } from "../../api/contracts";
import { downloadAnimalInspectionPdf, useAnimalInspections } from "../../api/animalManagement";
import { PageSkeleton, PageState, Pager, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ActionButton } from "../../components/ui/ActionButton";
import { MobilePage } from "../../components/ui/MobilePage";
import { DataTable, ListRefreshStatus, ModalPresence, RowActions } from "../../components/ui";
import { queryKeys } from "../../api/queryKeys";
import { useRetainedListData } from "../../hooks/useRetainedListData";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import type { WorkspaceView } from "../../state/ui";
import { setResumeInspectionId } from "./model";
import { InspectionListError } from "./InspectionListError";
import { InspectionDetailDialog } from "./InspectionDetailDialog";
import { pageSize, moduleLabel, formatDate } from "./inspectionListFormatting";

export function InspectionRecords({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const [offset, setOffset] = useState(0);
  const [room, setRoom] = useState("");
  const [status, setStatus] = useState("");
  const [sortKey, setSortKey] = useState("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState("");
  const params = { limit: pageSize, offset, room, status, sortKey, sortDir };
  const query = useAnimalInspections(params);
  const retained = useRetainedListData(query, queryKeys.animalInspections(params), "inspection-records");

  const items = retained.data?.items || [];
  const page = retained.data?.page || { offset: 0, limit: pageSize, total: 0 };
  const current = Math.floor(page.offset / page.limit) + 1;

  function updateSort(key: string, direction?: "asc" | "desc") {
    setSortKey(key);
    setSortDir(direction || (key === sortKey && sortDir === "asc" ? "desc" : "asc"));
    setOffset(0);
  }

  const refreshStatus = <ListRefreshStatus active={query.isFetching} />;
  const feedback =
    query.isError && retained.data ? (
      <InspectionListError refreshing={query.isFetching} retry={() => void query.refetch()} />
    ) : null;
  const filters = (
    <Form className="inspection-list-filters" component="div" layout={isMobile ? "vertical" : "inline"}>
      <Form.Item label="饲养间">
        <Select
          allowClear
          className="min-select-control"
          options={(retained.data?.filterOptions.rooms || []).map((item) => ({ label: item, value: item }))}
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
        <MobilePage
          titleInToolbar
          feature="animal-management"
          onBack={() => navigate("animal-inspection-entry")}
          title="巡检记录"
        >
          <WorkspaceToolbar
            title="巡检记录"
            actions={
              <Button icon={<ActionIcon name="back" />} onClick={() => navigate("animal-inspection-entry")}>
                返回巡检录入
              </Button>
            }
            ariaLabel="巡检记录操作"
            context={refreshStatus}
            filters={filters}
            primaryAction={
              <ActionButton
                icon={<ActionIcon name="create" />}
                tone="primary"
                onClick={() => navigate("animal-inspection-entry")}
              >
                新建巡检
              </ActionButton>
            }
          />
          {feedback}
          <Card className="animal-ant-card inspection-list-panel">
            {!retained.data ? (
              retained.loading ? (
                <PageSkeleton label="巡检记录" variant="table" />
              ) : (
                <PageState title="巡检记录加载失败" retry={() => void query.refetch()} />
              )
            ) : (
              <>
                {items.length ? (
                  <MobileList>
                    {items.map((item) => (
                      <MobileList.Item
                        description={`${item.status === "draft" ? "草稿" : "已提交"} · ${item.createdByName} · ${formatDate(item.updatedAt)}`}
                        extra={`${item.findingSummary?.total || 0} 项异常`}
                        key={item.id}
                        disabled={retained.blocked}
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
              </>
            )}
          </Card>
        </MobilePage>
        <ModalPresence>
          {selectedId ? (
            <InspectionDetailDialog key={selectedId} id={selectedId} onClose={() => setSelectedId("")} />
          ) : null}
        </ModalPresence>
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
          title="巡检记录"
          context={refreshStatus}
          filters={filters}
          primaryAction={
            <ActionButton
              icon={<ActionIcon name="create" />}
              tone="primary"
              onClick={() => navigate("animal-inspection-entry")}
            >
              新建巡检
            </ActionButton>
          }
        />

        {feedback}
        <Card className="animal-ant-card inspection-list-panel">
          {!retained.data ? (
            retained.loading ? (
              <PageSkeleton label="巡检记录" variant="table" />
            ) : (
              <PageState title="巡检记录加载失败" retry={() => void query.refetch()} />
            )
          ) : (
            <>
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
                      <RowActions
                        ariaLabel={`${item.roomName}巡检记录更多操作`}
                        lowFrequencyActions={[
                          {
                            icon: <ActionIcon name="download" />,
                            key: `export-${item.id}`,
                            label: "导出 PDF",
                            disabled: retained.blocked,
                            onClick: () => void downloadAnimalInspectionPdf(item.id),
                          },
                        ]}
                      >
                        <Button disabled={retained.blocked} onClick={() => setSelectedId(item.id)}>
                          详情
                        </Button>
                        {item.status === "draft" && item.createdBy === user.id ? (
                          <Button
                            disabled={retained.blocked}
                            onClick={() => {
                              setResumeInspectionId(item.id);
                              navigate("animal-inspection-entry");
                            }}
                          >
                            继续编辑
                          </Button>
                        ) : null}
                      </RowActions>
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
            </>
          )}
        </Card>
      </MobilePage>
      <ModalPresence>
        {selectedId ? (
          <InspectionDetailDialog key={selectedId} id={selectedId} onClose={() => setSelectedId("")} />
        ) : null}
      </ModalPresence>
    </>
  );
}
