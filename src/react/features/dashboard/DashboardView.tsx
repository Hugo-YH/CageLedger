import { ApartmentOutlined, ClockCircleOutlined, ExclamationCircleOutlined, InboxOutlined } from "@ant-design/icons";
import { Area, Rose } from "@ant-design/plots";
import { Badge, Button, Card, Col, Progress, Row, Select, Skeleton, Statistic, Tag, Typography } from "antd";
import { useMemo, useState } from "react";

import type { RoomOverview } from "../../api/dashboardOverview";
import type { DashboardOverviewResponse } from "../../api/dashboardOverview";
import { useDashboardOverview } from "../../api/dashboardOverview";
import { PageState } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { APP_VERSION } from "../../version";

const ROOM_PALETTE = ["#3872ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2", "#fa541c"];
const STRAIN_COLORS = ["#5B8FF9", "#5AD8A6", "#5D7092", "#F6BD16", "#E8684A", "#6DC8EC", "#9270CA", "#FF9D4D"];

type RoomAreaDatum = { day: string; cages: number; roomName?: string };

function formatYuan(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function hexToRgba(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function DashboardView({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const overview = useDashboardOverview(month);
  if (overview.isPending) return <DashboardSkeleton />;
  if (overview.isError || !overview.data) return <DashboardError retry={() => overview.refetch()} />;
  return <DashboardContent data={overview.data} month={month} onMonthChange={setMonth} navigate={navigate} />;
}

function DashboardContent({
  data,
  month,
  onMonthChange,
  navigate,
}: {
  data: DashboardOverviewResponse;
  month?: string;
  onMonthChange: (month?: string) => void;
  navigate: (view: WorkspaceView) => void;
}) {
  const { availableMonths, intake, rooms, pi } = data;
  const currentMonth = month === "all" ? "历史合计" : month || data.month;
  const tasks = [
    {
      label: "待接收批次",
      value: intake.batches,
      view: "intake-batches" as WorkspaceView,
      icon: <InboxOutlined />,
      tone: "processing",
    },
    {
      label: "上月饲养间",
      value: rooms.length,
      view: "quantity-sheet-entry" as WorkspaceView,
      icon: <ApartmentOutlined />,
      tone: "warning",
    },
    {
      label: "结算课题组",
      value: pi.length,
      view: "billing-settlement-candidates" as WorkspaceView,
      icon: <ClockCircleOutlined />,
      tone: "default",
    },
    {
      label: "上月接收批次",
      value: intake.trend.reduce((sum, item) => sum + item.batches, 0),
      view: "intake-batches" as WorkspaceView,
      icon: <ExclamationCircleOutlined />,
      tone: "error",
    },
  ];

  return (
    <section className="workspace-view dashboard-view ant-dashboard-view">
      <div className="dashboard-hero">
        <Typography.Text className="workspace-kicker" type="secondary">
          运营工作台
        </Typography.Text>
        <div className="workspace-title-line">
          <Typography.Title level={1}>实验动物笼位管理与计费系统</Typography.Title>
          <Tag className="workspace-status-badge" color="blue">
            {APP_VERSION}
          </Tag>
        </div>
        <Typography.Paragraph className="workspace-summary" type="secondary">
          接收、饲养与结算的运营概览，数据来自笼卡管理、数量统计表与项目负责人结算。
        </Typography.Paragraph>
      </div>
      <div className="workspace-body dashboard-workspace-body ant-dashboard-body">
        <div className="ant-dashboard-month-bar">
          <Select
            aria-label="选择统计月份"
            options={[
              { value: "all", label: "历史合计" },
              ...availableMonths.map((value) => ({ value, label: `${value.slice(0, 4)} 年 ${value.slice(5)} 月` })),
            ]}
            value={month ?? data.month}
            style={{ width: 160 }}
            onChange={(value) => onMonthChange(value)}
          />
          <Typography.Text type="secondary">当前统计月份：{currentMonth}</Typography.Text>
        </div>
        <Card className="ant-dashboard-section" size="small" title="待办任务">
          <Row gutter={[0, 12]}>
            {tasks.map((task) => (
              <Col key={task.label} lg={6} md={12} sm={12} xs={24}>
                <Button
                  aria-label={`查看${task.label}，当前 ${task.value} 项`}
                  className={`ant-dashboard-task is-${task.tone}`}
                  block
                  type="text"
                  onClick={() => navigate(task.view)}
                >
                  <span className="ant-dashboard-task-icon" aria-hidden="true">
                    {task.icon}
                  </span>
                  <span className="ant-dashboard-task-copy">
                    <Typography.Text>{task.label}</Typography.Text>
                    <Typography.Text className="ant-dashboard-task-action">查看详情</Typography.Text>
                  </span>
                  <Badge className="ant-dashboard-task-count" count={task.value} overflowCount={9999} showZero />
                </Button>
              </Col>
            ))}
          </Row>
        </Card>

        <Row gutter={[16, 16]}>
          <Col lg={14} xs={24}>
            <Card className="ant-dashboard-section" size="small" title="接收动物统计">
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  <Statistic title="接收批次" value={intake.batches} />
                </Col>
                <Col span={12}>
                  <Statistic title="接收只数" value={intake.animals} />
                </Col>
              </Row>
              <IntakeTrend items={intake.trend} unit={intake.trendUnit} />
            </Card>
          </Col>
          <Col lg={10} xs={24}>
            <Card className="ant-dashboard-section" size="small" title="品系分布">
              <StrainDistribution items={intake.strains} />
            </Card>
          </Col>
        </Row>

        <RoomOverviewCard rooms={rooms} />

        <Card className="ant-dashboard-section" size="small" title="饲养费统计">
          <PiFeeChart items={pi} />
        </Card>
      </div>
    </section>
  );
}

function PiFeeChart({ items }: { items: Array<{ pi: string; amount: number; iacucCount: number }> }) {
  const data = items.slice(0, 10);
  const maxAmount = Math.max(...data.map((item) => item.amount), 1);
  const renderRow = (item: (typeof data)[number]) => (
    <div className="ant-dashboard-pi-row" key={item.pi}>
      <div className="ant-dashboard-pi-row-head">
        <Typography.Text strong>
          {data.indexOf(item) + 1}. {item.pi}
        </Typography.Text>
        <Typography.Text className="ant-dashboard-pi-amount">{formatYuan(item.amount)}</Typography.Text>
      </div>
      <Progress
        percent={Math.max(Math.round((item.amount / maxAmount) * 100), 0)}
        showInfo={false}
        strokeColor={{ from: "#0958d9", to: "#68b2ff" }}
        trailColor="rgba(9, 88, 217, 0.08)"
        size="small"
      />
      <Typography.Text type="secondary" className="ant-dashboard-pi-sub">
        {item.iacucCount} 个伦理号
      </Typography.Text>
    </div>
  );
  return (
    <div className="ant-dashboard-pi-grid">
      <Row gutter={[24, 8]}>
        <Col xs={24} lg={12}>
          {data.slice(0, 5).map(renderRow)}
        </Col>
        <Col xs={24} lg={12}>
          {data.slice(5, 10).map(renderRow)}
        </Col>
      </Row>
    </div>
  );
}

function IntakeTrend({
  items,
  unit,
}: {
  items: Array<{ month?: string; day?: number; batches: number; animals: number }>;
  unit: "day" | "month";
}) {
  const data = items.map((item) => ({
    label: unit === "month" ? (item.month || "").slice(2) : `${item.day ?? 0}日`,
    animals: item.animals,
    batches: item.batches,
  }));
  return (
    <div className="ant-dashboard-trend">
      <Area
        data={data}
        xField="label"
        yField="animals"
        height={180}
        axis={{
          x: { title: false, labelAutoRotate: false, labelFormatter: (v: string) => v.replace("日", "") },
          y: { title: false },
        }}
        style={{
          shape: "smooth",
          fill: () =>
            `linear-gradient(90deg, ${hexToRgba("#0958d9", 0.92)} 0%, ${hexToRgba("#0958d9", 0.5)} 55%, ${hexToRgba("#0958d9", 0.1)} 100%)`,
        }}
        tooltip={{
          title: "label",
          items: [
            (datum: { animals: number }) => ({
              name: "接收只数",
              value: datum.animals,
            }),
          ],
        }}
        scale={{ y: { nice: true } }}
        legend={false}
      />
      <Typography.Text type="secondary" className="ant-dashboard-trend-caption">
        {unit === "month" ? "近 6 个月接收只数变化" : "当月每日接收只数变化"}
      </Typography.Text>
    </div>
  );
}

function StrainDistribution({ items }: { items: Array<{ strain: string; animals: number }> }) {
  const total = items.reduce((sum, item) => sum + item.animals, 0);
  const sorted = [...items].sort((a, b) => b.animals - a.animals);
  const top = sorted.slice(0, 5);
  const otherAnimals = sorted.slice(5).reduce((sum, item) => sum + item.animals, 0);
  const data = [
    ...top.map((item) => ({
      type: item.strain,
      value: Math.log1p(item.animals),
      animals: item.animals,
      percent: total ? (item.animals / total) * 100 : 0,
    })),
    ...(otherAnimals > 0
      ? [
          {
            type: "其他",
            value: Math.log1p(otherAnimals),
            animals: otherAnimals,
            percent: total ? (otherAnimals / total) * 100 : 0,
          },
        ]
      : []),
  ];
  const colorOf = (type: string) => {
    const index = data.findIndex((item) => item.type === type);
    return type === "其他" ? "#8C8C8C" : STRAIN_COLORS[index % STRAIN_COLORS.length];
  };
  return (
    <div className="ant-dashboard-pie">
      <Rose
        data={data}
        xField="type"
        yField="value"
        colorField="type"
        radius={0.9}
        style={{
          inset: 2,
          radius: 8,
          fill: (datum: { type: string }) => {
            const color = colorOf(datum.type);
            return `linear-gradient(180deg, ${hexToRgba(color, 0.95)} 0%, ${hexToRgba(color, 0.55)} 60%, ${hexToRgba(color, 0.2)} 100%)`;
          },
        }}
        axis={false}
        height={280}
        scale={{
          color: {
            range: data.map((item) => colorOf(item.type)),
          },
        }}
        label={{
          text: (item: { percent: number }) => `${item.percent.toFixed(0)}%`,
          position: "outside",
          fontSize: 10,
        }}
        legend={{
          color: {
            position: "bottom",
            layout: { justifyContent: "center" },
            labelFormatter: (label: string) => (label.length > 14 ? `${label.slice(0, 11)}…` : label),
          },
        }}
        tooltip={{
          title: "type",
          items: [
            (datum: { animals: number; percent: number }) => ({
              name: "接收只数",
              value: `${datum.animals}（${datum.percent.toFixed(0)}%）`,
            }),
          ],
        }}
      />
    </div>
  );
}

function RoomOverviewCard({ rooms }: { rooms: RoomOverview[] }) {
  const [selected, setSelected] = useState("__all__");
  const options = useMemo(
    () => [
      { value: "__all__", label: "全部饲养间" },
      ...rooms.map((room) => ({ value: room.roomName, label: room.roomName })),
    ],
    [rooms],
  );
  const trendUnit = rooms[0]?.trendUnit ?? "day";
  const chartData = useMemo(() => {
    const suffix = trendUnit === "month" ? "月" : "日";
    if (selected === "__all__") {
      return rooms.flatMap((room) =>
        room.trend.map((point) => ({ day: `${point.day}${suffix}`, cages: point.cages, roomName: room.roomName })),
      );
    }
    const room = rooms.find((item) => item.roomName === selected);
    return (room?.trend || []).map((point) => ({ day: `${point.day}${suffix}`, cages: point.cages }));
  }, [rooms, selected, trendUnit]);
  const room = rooms.find((item) => item.roomName === selected);
  const totalCageDays =
    selected === "__all__" ? rooms.reduce((sum, item) => sum + item.cageDays, 0) : room?.cageDays || 0;
  const palette = useMemo(() => rooms.map((_, index) => ROOM_PALETTE[index % ROOM_PALETTE.length]), [rooms]);
  const selectedColor = room ? ROOM_PALETTE[rooms.indexOf(room) % ROOM_PALETTE.length] : "#3872ff";
  const colorOf = (roomName?: string) => {
    const index = rooms.findIndex((item) => item.roomName === roomName);
    return index >= 0 ? ROOM_PALETTE[index % ROOM_PALETTE.length] : ROOM_PALETTE[0];
  };

  return (
    <Card className="ant-dashboard-section" size="small" title="饲养间笼位统计">
      <div className="ant-dashboard-room-toolbar">
        <Select
          aria-label="选择饲养间"
          options={options}
          value={selected}
          style={{ width: 180 }}
          onChange={setSelected}
        />
        <Typography.Text type="secondary">总笼日 {totalCageDays}</Typography.Text>
      </div>
      <div className="ant-dashboard-room-area">
        <Area
          data={chartData}
          xField="day"
          yField="cages"
          colorField={selected === "__all__" ? "roomName" : undefined}
          stack={selected === "__all__"}
          scale={selected === "__all__" ? { color: { range: palette }, y: { nice: true } } : { y: { nice: true } }}
          height={220}
          axis={{
            x: {
              title: false,
              labelAutoRotate: false,
              labelFormatter: (v: string) => v.replace("日", ""),
            },
            y: { title: false },
          }}
          style={{
            shape: "smooth",
            fill: (seriesData: RoomAreaDatum[]) => {
              const roomName = seriesData[0]?.roomName;
              const color = selected === "__all__" ? colorOf(roomName) : selectedColor;
              return `linear-gradient(90deg, ${hexToRgba(color, 0.95)} 0%, ${hexToRgba(color, 0.58)} 52%, ${hexToRgba(color, 0.16)} 100%)`;
            },
          }}
          line={selected === "__all__" ? undefined : { style: { stroke: selectedColor, lineWidth: 2 } }}
          tooltip={{
            title: "day",
            items:
              selected === "__all__"
                ? [{ field: "cages", name: "笼位" }]
                : [
                    (datum: RoomAreaDatum) => ({
                      name: selected,
                      value: datum.cages,
                    }),
                  ],
          }}
          legend={{ color: { position: "bottom", layout: { justifyContent: "center" } } }}
        />
      </div>
    </Card>
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
