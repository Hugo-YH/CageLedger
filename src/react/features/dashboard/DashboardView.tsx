import { Button, Card, Col, Progress, Row, Skeleton, Space, Statistic, Tag, Typography } from "antd";

import type { BootstrapResponse } from "../../api/contracts";
import { useBootstrap } from "../../api/bootstrap";
import { PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { APP_VERSION } from "../../version";

export function DashboardView({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const query = useBootstrap("summary");
  if (query.isPending) return <DashboardSkeleton />;
  if (query.isError || !query.data) return <DashboardError retry={() => query.refetch()} />;
  return <DashboardContent data={query.data} navigate={navigate} />;
}

function DashboardContent({ data, navigate }: { data: BootstrapResponse; navigate: (view: WorkspaceView) => void }) {
  const summary = data.dashboardSummary || {};
  const value = (key: string) => Number(summary[key] || 0);
  const total = value("total");
  const occupied = value("active") + value("reserved");
  const occupiedPct = percent(occupied, total);
  const facilities = data.facilitySummaries;
  const roomsById = new Map(data.rooms.map((room) => [String(room.id || ""), room]));
  const tasks = [
    { label: "待接收批次", value: value("intakePendingCount"), view: "intake-batches" as WorkspaceView },
    { label: "待进驻任务", value: value("openPlacementTaskCount"), view: "cages" as WorkspaceView },
    { label: "本月待办流程", value: value("currentMonthWorkflowTodoCount"), view: "workflow-center" as WorkspaceView },
    { label: "异常项", value: value("exceptionCount"), view: "workflow-center" as WorkspaceView },
  ];

  return (
    <section className="workspace-view dashboard-view ant-dashboard-view">
      <WorkspaceHeader
        kicker="运营工作台"
        title="实验动物笼位管理与计费系统"
        summary="接收、入驻、巡检、结算与核销的日常运营概览。"
        status={`v${APP_VERSION}`}
      />
      <div className="workspace-body dashboard-workspace-body ant-dashboard-body">
        <Row gutter={[16, 16]}>
          <DashboardStatistic label="总笼位" value={total} />
          <DashboardStatistic label="在用" status="success" value={value("active")} />
          <DashboardStatistic label="已预约" status="processing" value={value("reserved")} />
          <DashboardStatistic label="空笼位" value={value("empty")} />
          <DashboardStatistic label="未填结束日期" status="warning" value={value("periodOpen")} />
          <DashboardStatistic label="超期饲养" status="error" value={value("periodOverdue")} />
        </Row>

        <Card className="ant-dashboard-section" size="small" title="待办任务">
          <Row gutter={[0, 12]}>
            {tasks.map((task) => (
              <Col key={task.label} lg={6} md={12} sm={12} xs={24}>
                <Button className="ant-dashboard-task" block type="text" onClick={() => navigate(task.view)}>
                  <Typography.Text type="secondary">{task.label}</Typography.Text>
                  <Typography.Text strong>{task.value}</Typography.Text>
                  <Typography.Link>查看详情</Typography.Link>
                </Button>
              </Col>
            ))}
          </Row>
        </Card>

        <Row gutter={[16, 16]}>
          <Col lg={14} xs={24}>
            <Card className="ant-dashboard-section" size="small" title="设施运营摘要">
              <Row gutter={[16, 16]}>
                {["zhujiang", "bioisland"].map((facility) => (
                  <Col key={facility} md={12} xs={24}>
                    <FacilitySummary facility={facility} item={facilities.find((item) => item.facility === facility)} />
                  </Col>
                ))}
              </Row>
            </Card>
          </Col>
          <Col lg={10} xs={24}>
            <Card className="ant-dashboard-section" size="small" title="笼位状态分布">
              <div className="ant-dashboard-status">
                <Progress
                  aria-label="笼位占用率"
                  percent={occupiedPct}
                  size={132}
                  strokeColor="#1677ff"
                  type="circle"
                />
                <Space orientation="vertical" size={8}>
                  <StatusLine label="在用" total={total} value={value("active")} />
                  <StatusLine label="已预约" total={total} value={value("reserved")} />
                  <StatusLine label="空笼位" total={total} value={value("empty")} />
                </Space>
              </div>
            </Card>
          </Col>
        </Row>

        <Card className="ant-dashboard-section" size="small" title="饲养间使用情况">
          <div className="ant-dashboard-room-list" role="list">
            {data.roomSummaries.map((summary) => {
              const room = roomsById.get(summary.roomId);
              const usage = percent(summary.activeCount + summary.reservedCount, summary.slotCount);
              return (
                <div className="ant-dashboard-room-list-item" key={summary.roomId} role="listitem">
                  <div>
                    <Typography.Text strong>{String(room?.name || summary.roomName || summary.roomId)}</Typography.Text>
                    <Typography.Paragraph type="secondary">
                      {String(room?.area || "未设置区域")} · 总笼位 {summary.slotCount} · 在用 {summary.activeCount} ·
                      已预约 {summary.reservedCount}
                    </Typography.Paragraph>
                  </div>
                  <Progress
                    aria-label={`${String(room?.name || summary.roomName || summary.roomId)} 使用率`}
                    percent={usage}
                    size="small"
                    style={{ minWidth: 144 }}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </section>
  );
}

function DashboardStatistic({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status?: "success" | "processing" | "warning" | "error";
}) {
  return (
    <Col flex="1 1 160px">
      <Card className={`ant-dashboard-statistic ${status ? `is-${status}` : ""}`} size="small">
        <Statistic title={label} value={value} />
      </Card>
    </Col>
  );
}

function FacilitySummary({ facility, item = {} }: { facility: string; item?: Record<string, unknown> }) {
  const number = (key: string) => Number(item[key] || 0);
  const title = facility === "bioisland" ? "生物岛设施" : "珠江新城设施";
  return (
    <Card size="small" title={title} extra={<Tag>{number("roomCount")} 个饲养间</Tag>}>
      <Row gutter={12}>
        <Col span={8}>
          <Statistic title="在养笼数" value={number("activeCageCount")} />
        </Col>
        <Col span={8}>
          <Statistic title="在养只数" value={number("activeAnimalCount")} />
        </Col>
        <Col span={8}>
          <Statistic title="待进驻" value={number("openPlacementTaskCount")} />
        </Col>
      </Row>
    </Card>
  );
}

function StatusLine({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <Space size={8}>
      <Typography.Text>{label}</Typography.Text>
      <Typography.Text type="secondary">
        {value} 笼 · {percent(value, total)}%
      </Typography.Text>
    </Space>
  );
}

function DashboardSkeleton() {
  return (
    <section className="workspace-view dashboard-view">
      <Skeleton active paragraph={{ rows: 12 }} title={{ width: "34%" }} />
    </section>
  );
}

function DashboardError({ retry }: { retry: () => void }) {
  return <PageState detail="运营数据加载失败，请检查服务连接后重新加载。" retry={retry} title="运营数据加载失败" />;
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}
