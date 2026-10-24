import { ActionIcon } from "../../components/ui/ActionIcon";
import { ApartmentOutlined, ClockCircleOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Card, Col, Row, Select, Skeleton, Statistic, Tag, Typography, theme } from "antd";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { RoomOverview } from "../../api/dashboardOverview";
import type { DashboardOverviewResponse } from "../../api/dashboardOverview";
import { useDashboardOverview } from "../../api/dashboardOverview";
import { formatMoney, PageState } from "../../components/WorkspaceUi";
import { CommandBar, ListRefreshStatus } from "../../components/ui";
import type { WorkspaceView } from "../../state/ui";
import { useViewVisibility } from "../../state/systemFeatureVisibility";
import { APP_VERSION } from "../../version";
import { PiFeeSummary } from "./PiFeeSummary";

// @ant-design/plots 体积较大，拆为独立懒加载块：仅图表卡实际渲染时下载。
const AreaChart = lazy(() => import("@ant-design/plots/es/components/area"));
const RoseChart = lazy(() => import("@ant-design/plots/es/components/rose"));

function ChartBoundary({ height, children }: { height: number; children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="ant-dashboard-chart-loading" style={{ height }}>
          <Skeleton active paragraph={{ rows: 3, width: "100%" }} title={false} />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/** Loads the chart runtime only after its card enters the viewport. */
function DeferredChart({ height, children }: { height: number; children: ReactNode }) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { threshold: 0.01 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={targetRef}>
      {isVisible ? (
        <ChartBoundary height={height}>{children}</ChartBoundary>
      ) : (
        <div aria-busy="true" className="ant-dashboard-chart-loading" style={{ height }}>
          <Skeleton active paragraph={{ rows: 3, width: "100%" }} title={false} />
        </div>
      )}
    </div>
  );
}

const ROOM_PALETTE = ["#3872ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2", "#fa541c"];
const STRAIN_COLORS = ["#5B8FF9", "#5AD8A6", "#5D7092", "#F6BD16", "#E8684A", "#6DC8EC", "#9270CA", "#FF9D4D"];

type RoomAreaDatum = { day: string; cages: number; roomName?: string };

function hexToRgba(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function DashboardView({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [displayedMonth, setDisplayedMonth] = useState<string | undefined>(undefined);
  const overview = useDashboardOverview(month);
  // Retain the displayed query in the cache while another month loads or fails.
  // The disabled observer does not request data or store a second local copy.
  const displayed = useDashboardOverview(displayedMonth, false);
  useEffect(() => {
    if (overview.isSuccess) setDisplayedMonth(month);
  }, [month, overview.isSuccess]);
  const data = overview.data ?? displayed.data;
  if (!data) {
    return overview.isPending ? <DashboardSkeleton /> : <DashboardError retry={() => overview.refetch()} />;
  }
  return (
    <DashboardContent
      data={data}
      month={month}
      onMonthChange={setMonth}
      navigate={navigate}
      refreshing={overview.isFetching}
      failed={overview.isError}
      retry={() => void overview.refetch()}
    />
  );
}

function DashboardContent({
  data,
  month,
  onMonthChange,
  navigate,
  refreshing,
  failed,
  retry,
}: {
  data: DashboardOverviewResponse;
  month?: string;
  onMonthChange: (month?: string) => void;
  navigate: (view: WorkspaceView) => void;
  refreshing: boolean;
  failed: boolean;
  retry: () => void;
}) {
  const { token } = theme.useToken();
  const visible = useViewVisibility();
  const { availableMonths, intake, rooms, pi } = data;
  const currentMonth = data.month === "all" ? "历史合计" : data.month;
  const feedingFeeTotal = data.feedingFeeTotal;
  const feedingFeeValue =
    feedingFeeTotal?.amountState === "ready" && feedingFeeTotal.amount != null
      ? formatMoney(feedingFeeTotal.amount)
      : feedingFeeTotal?.amountState === "error"
        ? "待核查"
        : feedingFeeTotal?.amountState === "pending"
          ? "待核算"
          : "—";
  const tasks = [
    {
      label: "待接收批次",
      value: intake.batches,
      view: "intake-batches" as WorkspaceView,
      icon: <InboxOutlined />,
      tone: "processing",
    },
    {
      label: "动物实验项目",
      value: data.quantitySheetIacucCount ?? "—",
      view: "billing-quantity-saved" as WorkspaceView,
      icon: <ApartmentOutlined />,
      tone: "warning",
    },
    {
      label: "饲养费金额",
      value: feedingFeeValue,
      kind: "amount",
      ariaLabel: `查看饲养费金额，${feedingFeeValue}`,
      view: "billing-settlement" as WorkspaceView,
      icon: <ClockCircleOutlined />,
      tone: "default",
    },
  ];

  return (
    <section className="workspace-view dashboard-view ant-dashboard-view">
      <CommandBar
        title="实验动物笼位管理与计费系统"
        description="接收、饲养与结算的运营概览，数据来自笼卡管理、数量统计表与项目负责人结算。"
        ariaLabel="运营工作台"
        context={<Tag color="blue">{APP_VERSION}</Tag>}
      />
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
        <ListRefreshStatus active={refreshing} />
        {failed ? (
          <Alert
            type="error"
            showIcon
            title="运营数据更新失败，暂显示上次结果"
            action={
              <Button icon={<ActionIcon name="refresh" />} loading={refreshing} onClick={retry}>
                重试
              </Button>
            }
          />
        ) : null}
        <Card className="ant-dashboard-section" size="small" title="待办任务">
          <Row gutter={[0, 12]}>
            {tasks.map((task) => {
              const shown = visible(task.view);
              const isAmount = task.kind === "amount";
              const action = shown ? (
                <Typography.Text className="ant-dashboard-task-action">查看详情</Typography.Text>
              ) : null;
              const contentClassName = `ant-dashboard-task-content${isAmount ? " is-amount" : ""}`;
              const content = (
                <>
                  <span className="ant-dashboard-task-icon" aria-hidden="true">
                    {task.icon}
                  </span>
                  <span className="ant-dashboard-task-copy">
                    {isAmount ? (
                      <>
                        <span className="ant-dashboard-task-heading">
                          <Typography.Text title={task.label}>{task.label}</Typography.Text>
                          {action}
                        </span>
                        <Typography.Text className="ant-dashboard-task-amount" title={String(task.value)}>
                          {task.value}
                        </Typography.Text>
                      </>
                    ) : (
                      <>
                        <Typography.Text title={task.label}>{task.label}</Typography.Text>
                        {action}
                      </>
                    )}
                  </span>
                  {!isAmount ? (
                    <Badge
                      className="ant-dashboard-task-count"
                      count={task.value}
                      overflowCount={9999}
                      showZero
                      styles={
                        task.value === 0
                          ? { indicator: { background: token.colorFillSecondary, color: token.colorTextSecondary } }
                          : undefined
                      }
                    />
                  ) : null}
                </>
              );
              return (
                <Col key={task.label} lg={8} md={12} sm={12} xs={24}>
                  {shown ? (
                    <Button
                      aria-label={
                        task.ariaLabel ??
                        (typeof task.value === "number"
                          ? `查看${task.label}，当前 ${task.value} 项`
                          : `查看${task.label}，暂无统计`)
                      }
                      className={`ant-dashboard-task is-${task.tone}`}
                      classNames={{ content: contentClassName }}
                      block
                      type="text"
                      onClick={() => navigate(task.view)}
                    >
                      {content}
                    </Button>
                  ) : (
                    <div className={`ant-dashboard-task is-${task.tone} is-hidden`}>
                      <span className={contentClassName}>{content}</span>
                    </div>
                  )}
                </Col>
              );
            })}
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
          <PiFeeSummary key={data.month} items={pi} />
        </Card>
      </div>
    </section>
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
      <DeferredChart height={180}>
        <AreaChart
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
      </DeferredChart>
      <Typography.Text type="secondary" className="ant-dashboard-trend-caption">
        {unit === "month" ? "近 6 个月接收只数变化" : "当月每日接收只数变化"}
      </Typography.Text>
    </div>
  );
}

function StrainDistribution({ items }: { items: Array<{ strain: string; animals: number }> }) {
  const { token } = theme.useToken();
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
      <DeferredChart height={280}>
        <RoseChart
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
            fontSize: token.fontSizeSM,
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
      </DeferredChart>
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
        <DeferredChart height={220}>
          <AreaChart
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
        </DeferredChart>
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="运营总览正在加载"
      className="workspace-view dashboard-view ant-dashboard-view"
      data-ui="page-skeleton"
      role="status"
    >
      <span className="app-visually-hidden">运营总览正在加载</span>
      <div aria-hidden="true">
        <CommandBar
          title={<Skeleton.Input active size="large" style={{ width: "min(360px, 100%)" }} />}
          context={<Skeleton.Button active size="small" />}
        />
      </div>
      <div aria-hidden="true" className="workspace-body dashboard-workspace-body ant-dashboard-body">
        <div className="ant-dashboard-month-bar">
          <Skeleton.Input active size="medium" style={{ width: 160 }} />
          <Skeleton.Input active size="small" style={{ width: 132 }} />
        </div>
        <Card
          className="ant-dashboard-section"
          size="small"
          title={<Skeleton.Input active size="small" style={{ width: 72 }} />}
        >
          <Row gutter={[0, 12]}>
            {Array.from({ length: 3 }, (_, index) => (
              <Col key={index} lg={8} md={12} sm={12} xs={24}>
                <div className="ant-dashboard-task dashboard-skeleton-task">
                  <Skeleton.Avatar active shape="square" size="medium" />
                  <Skeleton active paragraph={{ rows: 1, width: ["72%"] }} title={false} />
                  <Skeleton.Button active size="small" />
                </div>
              </Col>
            ))}
          </Row>
        </Card>
        <Row gutter={[16, 16]}>
          <Col lg={14} xs={24}>
            <DashboardSkeletonCard chart />
          </Col>
          <Col lg={10} xs={24}>
            <DashboardSkeletonCard chart />
          </Col>
        </Row>
        <DashboardSkeletonCard chart />
        <DashboardSkeletonCard chart />
      </div>
    </section>
  );
}

function DashboardSkeletonCard({ chart = false }: { chart?: boolean }) {
  return (
    <Card
      className="ant-dashboard-section dashboard-skeleton-card"
      size="small"
      title={<Skeleton.Input active size="small" style={{ width: 96 }} />}
    >
      <Skeleton active paragraph={{ rows: chart ? 5 : 3, width: "100%" }} title={chart ? false : { width: "42%" }} />
    </Card>
  );
}

function DashboardError({ retry }: { retry: () => void }) {
  return <PageState detail="运营数据加载失败，请检查服务连接后重新加载。" retry={retry} title="运营数据加载失败" />;
}
