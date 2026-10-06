import { Button } from "antd";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { CommandBar } from "../../components/ui";

import { QuantitySheetView } from "./QuantitySheetView";
import type { SessionUser } from "../../api/contracts";
import type { WorkspaceView } from "../../state/ui";
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
  const title = billingTitle(mode);
  const navigationAction =
    isMobile && mode !== "quantity-entry" ? (
      <Button icon={<ActionIcon name="back" />} onClick={() => navigate("billing-quantity-entry")}>
        返回数量录入
      </Button>
    ) : undefined;
  const body = (
    <div data-feature="billing">
      {mode === "quantity-entry" ? (
        <QuantitySheetView user={user} mode="entry" navigationAction={navigationAction} />
      ) : null}
      {mode === "quantity-saved" ? (
        <QuantitySheetView user={user} mode="saved" navigationAction={navigationAction} />
      ) : null}
      {mode === "cage-map" ? (
        <section className="panel billing-unavailable-panel" aria-label="动态笼位图核算">
          <CommandBar
            title="动态笼位图核算"
            description="系统按当前笼位占用时间线生成每日费用。"
            actions={navigationAction}
          />
          <div className="empty-state">
            <h3>选择项目负责人生成结算预览</h3>
            <p>进入“结算管理”，选择动态笼位图来源后生成结算预览。</p>
          </div>
          <div className="billing-unavailable-overlay" role="status" aria-live="polite">
            <span className="billing-unavailable-mark" aria-hidden="true">
              调试
            </span>
            <strong>功能调试中，暂未启用</strong>
            <p>动态笼位图核算完成校验后开放。当前请使用录入数量统计表和结算管理。</p>
          </div>
        </section>
      ) : null}
      {mode === "settlement" ? (
        <section className="ledger-section" aria-label="结算管理工作区">
          <SettlementCandidateList source="quantity_sheet" user={user} navigationAction={navigationAction} />
        </section>
      ) : null}
      {mode === "monthly-summary" && user.role === "admin" ? (
        <MonthlyBillingSummary navigationAction={navigationAction} />
      ) : null}
    </div>
  );
  return (
    <section className="workspace-view billing-workspace react-billing-view" data-feature="billing" aria-label={title}>
      <div className="workspace-body billing-workspace-body">{body}</div>
    </section>
  );
}

function billingTitle(mode: BillingMode) {
  if (mode === "cage-map") return "动态笼位图结算";
  if (mode === "quantity-entry") return "录入数量统计表";
  if (mode === "quantity-saved") return "已保存数量统计表";
  if (mode === "monthly-summary") return "汇总导出";
  return "结算管理";
}
