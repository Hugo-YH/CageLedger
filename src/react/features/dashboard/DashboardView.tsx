import type { CSSProperties } from "react";

import type { BootstrapResponse } from "../../api/contracts";
import { useBootstrap } from "../../api/bootstrap";
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
  const occupiedPct = total ? Math.round(occupied / total * 100) : 0;
  const todo = value("intakePendingCount") + value("openPlacementTaskCount") + value("currentMonthWorkflowTodoCount");
  const facilities = data.facilitySummaries as Array<Record<string, unknown>>;
  const roomsById = new Map(data.rooms.map((room) => [String(room.id || ""), room]));

  return (
    <section className="workspace-view dashboard-view">
      <section className="workspace-head">
        <div className="workspace-head-main">
          <span className="workspace-kicker">运营工作台</span>
          <div className="workspace-title-line"><h1>实验动物笼位管理与计费系统</h1><span className="workspace-status-badge">当前版本 v{APP_VERSION}</span></div>
          <p className="workspace-summary">围绕接收、入驻、结算和流程推进组织日常工作，首屏直接显示本周待办、异常项和两设施口径。</p>
          <div className="workspace-meta-strip">
            <Meta label="总笼位" value={total} />
            <Meta label="本周待办" value={todo} tone="todo" />
            <Meta label="异常项" value={value("exceptionCount")} tone={value("exceptionCount") ? "warning" : "success"} />
          </div>
        </div>
      </section>
      <div className="workspace-body dashboard-workspace-body">
        <div className="dashboard-metrics">
          <Metric label="总笼位" value={total} tone="neutral" />
          <Metric label="在用" value={value("active")} tone="active" />
          <Metric label="已预约" value={value("reserved")} tone="reserved" />
          <Metric label="空" value={value("empty")} tone="empty" />
          <Metric label="未填结束" value={value("periodOpen")} tone="empty" />
          <Metric label="正常周期" value={value("periodNormal")} tone="active" />
          <Metric label="超期饲养" value={value("periodOverdue")} tone="reserved" />
        </div>
        <div className="dashboard-overview-grid">
          <Overview title="待接收批次" value={value("intakePendingCount")} note="接收笼卡后统一打印，已接收会进入待进驻。" onClick={() => navigate("intake")} />
          <Overview title="待进驻任务" value={value("openPlacementTaskCount")} note="预留或正式入驻后会从当前房间待办中移除。" onClick={() => navigate("cages")} />
          <Overview title="本月待办流程" value={value("currentMonthWorkflowTodoCount")} note="已生成、已发送、已签字交回都会留在待办链。" onClick={() => navigate("workflow-center")} />
          <Overview title="异常项" value={value("exceptionCount")} note={`房间未匹配 ${value("unmatchedIntakeCount")} · 待进驻超期 ${value("overduePlacementCount")} · 流程待推进 ${value("stalledWorkflowCount")}`} onClick={() => navigate("workflow-center")} />
        </div>
        <div className="dashboard-main-grid">
          <section className="panel dashboard-quick-panel">
            <div className="panel-head compact"><h2>两设施运营摘要</h2></div>
            <div className="dashboard-facility-grid">
              {["zhujiang", "bioisland"].map((key) => <FacilityCard key={key} facility={key} item={facilities.find((item) => item.facility === key)} />)}
            </div>
          </section>
          <section className="panel dashboard-status-panel">
            <div className="panel-head compact"><h2>笼位状态分布</h2></div>
            <div className="status-chart">
              <div className="donut-chart" style={{ "--active": percent(value("active"), total), "--reserved": percent(value("reserved"), total), "--empty": percent(value("empty"), total) } as CSSProperties}><span>{occupiedPct}%</span><small>占用/预约</small></div>
              <div className="chart-legend">
                <Legend tone="active" label="在用" value={value("active")} total={total} />
                <Legend tone="reserved" label="已预约" value={value("reserved")} total={total} />
                <Legend tone="empty" label="空" value={value("empty")} total={total} />
              </div>
            </div>
          </section>
        </div>
        <section className="panel dashboard-room-panel">
          <div className="panel-head compact"><h2>饲养间使用情况</h2></div>
          <div className="room-capacity-list">
            {data.roomSummaries.map((room) => <RoomCapacity key={room.roomId} summary={room} room={roomsById.get(room.roomId)} />)}
          </div>
        </section>
      </div>
    </section>
  );
}

function Meta({ label, value, tone = "neutral" }: { label: string; value: number; tone?: string }) {
  return <div className={`workspace-meta-card ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function Overview({ title, value, note, onClick }: { title: string; value: number; note: string; onClick: () => void }) {
  return <button className="dashboard-overview-card" type="button" onClick={onClick}><span>{title}</span><strong>{value}</strong><small>{note}</small></button>;
}

function FacilityCard({ facility, item = {} }: { facility: string; item?: Record<string, unknown> }) {
  const number = (key: string) => Number(item[key] || 0);
  return <article className="dashboard-facility-card"><div className="dashboard-facility-head"><div><strong>{facility === "bioisland" ? "生物岛设施" : "珠江新城设施"}</strong><span>{number("roomCount")} 个饲养间</span></div><span className="pill active">本月完成 {number("currentMonthWorkflowDoneCount")}</span></div><div className="dashboard-facility-metrics"><Summary label="在养笼数" value={number("activeCageCount")} /><Summary label="在养只数" value={number("activeAnimalCount")} /><Summary label="待进驻" value={number("openPlacementTaskCount")} /></div></article>;
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="summary-tile"><span>{label}</span><strong>{value}</strong></div>;
}

function Legend({ tone, label, value, total }: { tone: string; label: string; value: number; total: number }) {
  return <div className="chart-legend-item"><span className={`status-dot ${tone}`} /><strong>{label}</strong><small>{value} 笼 · {percent(value, total)}%</small></div>;
}

function RoomCapacity({ summary, room = {} }: { summary: BootstrapResponse["roomSummaries"][number]; room?: Record<string, unknown> }) {
  const occupiedPct = percent(summary.activeCount + summary.reservedCount, summary.slotCount);
  return <div className="room-capacity-row"><div className="room-capacity-head"><div><strong>{String(room.name || summary.roomName || summary.roomId)}</strong><span>{String(room.area || "未设置区域")} · {summary.slotCount} 笼</span></div><em>{occupiedPct}% 占用/预约</em></div><div className="room-capacity-meta"><span className="meta-pill active">在用 {summary.activeCount}</span><span className="meta-pill reserved">已预约 {summary.reservedCount}</span><span className="meta-pill empty">空 {summary.emptyCount}</span><span className="meta-pill total">总笼位 {summary.slotCount}</span></div></div>;
}

function DashboardSkeleton() {
  return <section className="workspace-view dashboard-view"><section className="workspace-head"><div className="workspace-head-main"><span className="workspace-kicker">运营工作台</span><div className="workspace-title-line"><h1>实验动物笼位管理与计费系统</h1></div><p className="workspace-summary">正在加载运营数据...</p></div></section></section>;
}

function DashboardError({ retry }: { retry: () => void }) {
  return <section className="workspace-view"><div className="empty-state"><strong>运营数据加载失败</strong><button className="primary" type="button" onClick={retry}>重新加载</button></div></section>;
}

function percent(value: number, total: number) {
  return total ? Math.round(value / total * 100) : 0;
}
