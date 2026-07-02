import { useState } from "react";

import { QuantitySheetView } from "./QuantitySheetView";
import type { SessionUser } from "../../api/contracts";
import { SettlementCandidateList } from "./components/SettlementCandidateList";

const currentMonth = new Date().toISOString().slice(0, 7);
type BillingMode = "cage-map" | "quantity-entry" | "quantity-saved" | "settlement";

export function BillingView({ user, mode }: { user: SessionUser; mode: BillingMode }) {
  const [source, setSource] = useState<"quantity_sheet" | "cage_map">("quantity_sheet");
  const title = billingTitle(mode);
  return (
    <section className="workspace-view billing-workspace react-billing-view">
      <header className="workspace-head">
        <div className="workspace-head-main">
          <span className="workspace-kicker">饲养费核算工作台</span>
          <div className="workspace-title-line">
            <h1>{title}</h1>
            <span className="workspace-status-badge">{billingBadge(mode, source)}</span>
          </div>
          <p>{billingDescription(mode)}</p>
          <div className="workspace-meta-strip">
            <div className="workspace-meta-card">
              <span>结算月份</span>
              <strong>{currentMonth.replace("-", "年")}月</strong>
            </div>
            <div className="workspace-meta-card success">
              <span>当前任务</span>
              <strong>{title}</strong>
            </div>
          </div>
        </div>
      </header>
      <div className="workspace-body billing-workspace-body">
        {mode === "quantity-entry" ? <QuantitySheetView user={user} mode="entry" /> : null}
        {mode === "quantity-saved" ? <QuantitySheetView user={user} mode="saved" /> : null}
        {mode === "cage-map" ? (
          <section className="panel billing-unavailable-panel" aria-labelledby="cage-map-panel-title">
            <div className="panel-head">
              <div className="panel-title-line">
                <h2 id="cage-map-panel-title">动态笼位图核算</h2>
                <p>系统按当前笼位占用时间线生成每日费用。</p>
              </div>
            </div>
            <div className="empty-state">
              <h3>选择项目负责人生成结算预览</h3>
              <p>进入“按项目负责人结算”，选择动态笼位图来源后生成结算预览。</p>
            </div>
            <div className="billing-unavailable-overlay" role="status" aria-live="polite">
              <span className="billing-unavailable-mark" aria-hidden="true">
                调试
              </span>
              <strong>功能调试中，暂未启用</strong>
              <p>动态笼位图核算完成校验后开放。当前请使用数量统计表录入和按项目负责人结算。</p>
            </div>
          </section>
        ) : null}
        {mode === "settlement" ? (
          <>
            <section className="panel billing-guide-panel">
              <div className="panel-head">
                <div className="panel-title-line">
                  <h2>结算数据来源</h2>
                </div>
              </div>
              <div className="billing-guide-grid" role="tablist" aria-label="结算数据来源">
                <button
                  className={`billing-guide-card ${source === "cage_map" ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={source === "cage_map"}
                  onClick={() => setSource("cage_map")}
                >
                  <strong>动态笼位图（自动）</strong>
                  <span>按笼位真实占用时间线核算</span>
                </button>
                <button
                  className={`billing-guide-card ${source === "quantity_sheet" ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={source === "quantity_sheet"}
                  onClick={() => setSource("quantity_sheet")}
                >
                  <strong>数量统计表（录入）</strong>
                  <span>汇总当前月份已保存统计表</span>
                </button>
              </div>
            </section>
            <SettlementCandidateList source={source} />
          </>
        ) : null}
      </div>
    </section>
  );
}

function billingTitle(mode: BillingMode) {
  if (mode === "cage-map") return "动态笼位图结算";
  if (mode === "quantity-entry") return "数量统计表录入";
  if (mode === "quantity-saved") return "已保存数量统计表";
  return "按项目负责人结算";
}

function billingBadge(mode: BillingMode, source: "quantity_sheet" | "cage_map") {
  if (mode === "cage-map") return "自动核算";
  if (mode === "quantity-entry") return "人工录入";
  if (mode === "quantity-saved") return "数据维护";
  return `当前来源：${source === "quantity_sheet" ? "数量统计表" : "动态笼位图"}`;
}

function billingDescription(mode: BillingMode) {
  if (mode === "cage-map") return "按笼位真实占用时间线检查核算数据，适用于日常维护完整的饲养间。";
  if (mode === "quantity-entry") return "按伦理号和房间录入月度数量变化，保存后进入结算汇总范围。";
  if (mode === "quantity-saved") return "集中检索、预览、编辑和导出已保存的数量统计表。";
  return "选择月份、项目负责人和数据来源，自动合并负责人名下伦理并生成结算单。";
}
