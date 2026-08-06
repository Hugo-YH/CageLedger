import { useState } from "react";
import { Card, Segmented, Typography } from "antd";

import { QuantitySheetView } from "./QuantitySheetView";
import type { SessionUser } from "../../api/contracts";
import type { WorkspaceView } from "../../state/ui";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { SettlementCandidateList } from "./components/SettlementCandidateList";
import { MonthlyBillingSummary } from "./components/MonthlyBillingSummary";

type BillingMode = "cage-map" | "quantity-entry" | "quantity-saved" | "settlement" | "monthly-summary";

export function BillingView({
  user,
  mode,
  navigate,
}: {
  user: SessionUser;
  mode: BillingMode;
  navigate: (view: WorkspaceView) => void;
}) {
  const isMobile = useIsMobileLayout();
  const [source, setSource] = useState<"quantity_sheet" | "cage_map">("quantity_sheet");
  const title = billingTitle(mode);
  const body = (
    <div data-feature="billing">
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
          <Card className="settlement-source-card" size="small" title="结算数据来源">
            <Segmented
              block
              options={[
                { label: "数量统计表（录入）", value: "quantity_sheet" },
                { label: "动态笼位图（自动）", value: "cage_map" },
              ]}
              value={source}
              onChange={(value) => setSource(value as "quantity_sheet" | "cage_map")}
            />
            <Typography.Paragraph className="settlement-source-help" type="secondary">
              数量统计表按已保存月度台账结算；动态笼位图仍处于调试阶段。
            </Typography.Paragraph>
          </Card>
          <SettlementCandidateList source={source} />
        </>
      ) : null}
      {mode === "monthly-summary" && user.role === "admin" ? <MonthlyBillingSummary /> : null}
    </div>
  );
  if (isMobile) {
    return (
      <MobilePage onBack={() => navigate("billing-quantity-entry")} title={title} titleAsHeading={false}>
        {body}
      </MobilePage>
    );
  }
  return (
    <section className="workspace-view billing-workspace react-billing-view" data-feature="billing">
      <div className="workspace-body billing-workspace-body">{body}</div>
    </section>
  );
}

function billingTitle(mode: BillingMode) {
  if (mode === "cage-map") return "动态笼位图结算";
  if (mode === "quantity-entry") return "数量统计表录入";
  if (mode === "quantity-saved") return "已保存数量统计表";
  if (mode === "monthly-summary") return "月度饲养费汇总";
  return "按项目负责人结算";
}
