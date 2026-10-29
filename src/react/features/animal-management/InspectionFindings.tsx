import { ActionIcon } from "../../components/ui/ActionIcon";
import { useState } from "react";
import { List as MobileList } from "antd-mobile";
import { Button, Card, Empty, Form, Select, Tag } from "antd";
import type { InspectionFindingSummary } from "../../api/contracts";
import { useAnimalFindings } from "../../api/animalManagement";
import { PageSkeleton, PageState, Pager, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { MobilePage } from "../../components/ui/MobilePage";
import { DataTable, ListRefreshStatus, ModalPresence } from "../../components/ui";
import { queryKeys } from "../../api/queryKeys";
import { useRetainedListData } from "../../hooks/useRetainedListData";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import type { WorkspaceView } from "../../state/ui";
import { FindingDialog } from "./InspectionFindingDialog";
import { FINDING_STATUS_LABELS, findingLocation } from "./model";
import { InspectionListError } from "./InspectionListError";
import { pageSize, findingStatusColor } from "./inspectionListFormatting";

export function InspectionFindings({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<InspectionFindingSummary | null>(null);
  const params = { limit: pageSize, offset, status };
  const query = useAnimalFindings(params);
  const retained = useRetainedListData(query, queryKeys.animalFindings(params), "inspection-findings");
  const page = retained.data?.page || { offset: 0, limit: pageSize, total: 0 };
  const current = Math.floor(page.offset / page.limit) + 1;
  const refreshStatus = <ListRefreshStatus active={query.isFetching} />;
  const feedback =
    query.isError && retained.data ? (
      <InspectionListError refreshing={query.isFetching} retry={() => void query.refetch()} />
    ) : null;
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
      {refreshStatus}
    </Form>
  );
  if (isMobile) {
    const findings = retained.data?.items || [];
    return (
      <>
        <MobilePage
          titleInToolbar
          feature="animal-management"
          onBack={() => navigate("animal-inspection-entry")}
          title="异常处置"
        >
          <WorkspaceToolbar
            title="异常处置"
            ariaLabel="异常处置"
            filters={filters}
            actions={
              <Button icon={<ActionIcon name="back" />} onClick={() => navigate("animal-inspection-entry")}>
                返回巡检录入
              </Button>
            }
          />
          {feedback}
          <Card className="animal-ant-card inspection-list-panel">
            {!retained.data ? (
              retained.loading ? (
                <PageSkeleton label="异常处置项" variant="table" />
              ) : (
                <PageState title="异常处置项加载失败" retry={() => void query.refetch()} />
              )
            ) : (
              <>
                {findings.length ? (
                  <MobileList>
                    {findings.map((item) => (
                      <MobileList.Item
                        description={`${findingLocation(item)} · ${FINDING_STATUS_LABELS[item.status]}`}
                        key={item.id}
                        disabled={retained.blocked}
                        onClick={() => {
                          if (!retained.blocked) setSelected(item);
                        }}
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
              </>
            )}
          </Card>
        </MobilePage>
        <ModalPresence>
          {selected ? <FindingDialog key={selected.id} finding={selected} onClose={() => setSelected(null)} /> : null}
        </ModalPresence>
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
        <WorkspaceToolbar title="异常处置" ariaLabel="异常处置" filters={filters} />
        {feedback}
        <Card className="animal-ant-card inspection-list-panel">
          {!retained.data ? (
            retained.loading ? (
              <PageSkeleton label="异常处置项" variant="table" />
            ) : (
              <PageState title="异常处置项加载失败" retry={() => void query.refetch()} />
            )
          ) : (
            <>
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
                      <Button
                        type="primary"
                        disabled={retained.blocked}
                        onClick={() => {
                          if (!retained.blocked) setSelected(item);
                        }}
                      >
                        处置
                      </Button>
                    ),
                  },
                ]}
                dataSource={retained.data?.items || []}
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
            </>
          )}
        </Card>
      </MobilePage>
      <ModalPresence>
        {selected ? <FindingDialog key={selected.id} finding={selected} onClose={() => setSelected(null)} /> : null}
      </ModalPresence>
    </>
  );
}
