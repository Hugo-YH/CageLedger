import { useState } from "react";
import { AuditOutlined } from "@ant-design/icons";
import { Button, Card, Space, Tabs, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import type { WorkspaceView } from "../../state/ui";
import { WorkspaceHeader } from "../../components/WorkspaceUi";
import { breadcrumb, billingSwitchItems } from "../shell/workspaceNavigation";
import { ClaimsPanel, LegacyPanel, ObligationsPanel, ReconciliationPanel } from "./components/ReimbursementLedger";
import { ReimbursementClaimDialog } from "./components/ReimbursementClaimDialog";

type LedgerTab = "obligations" | "claims" | "reconciliation" | "legacy";

const tabs: Array<[LedgerTab, string]> = [
  ["obligations", "结算应收"],
  ["claims", "报销单"],
  ["reconciliation", "核销中心"],
  ["legacy", "历史台账"],
];

export function WorkflowCenterView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const [tab, setTab] = useState<LedgerTab>("obligations");
  const [claimId, setClaimId] = useState("");
  const [creatingClaim, setCreatingClaim] = useState(false);
  const title = tabs.find(([key]) => key === tab)?.[1] || "结算应收";

  return (
    <section className="workspace-view workflow-center-view reimbursement-ledger-view" data-feature="workflow">
      <WorkspaceHeader
        kicker="结算与报销台账中心"
        title="结算与报销台账"
        breadcrumbs={[breadcrumb("饲养费管理", () => navigate("billing-quantity-entry"))]}
        summary="结算应收保留费用产生负责人；报销单经费负责人可跨项目负责人分摊核销。"
        status={title}
        switcherLabel="饲养费功能"
        switcherItems={billingSwitchItems(navigate, user.role === "admin")}
      />
      <div className="workspace-body workflow-workspace-body">
        <Card
          className="reimbursement-ledger-panel"
          title={
            <Space size={8}>
              <AuditOutlined />
              <Typography.Title level={2} style={{ margin: 0 }}>
                核销工作台
              </Typography.Title>
            </Space>
          }
          extra={
            tab === "claims" ? (
              <Button type="primary" onClick={() => setCreatingClaim(true)}>
                新建报销单
              </Button>
            ) : null
          }
        >
          <Typography.Paragraph className="reimbursement-ledger-description" type="secondary">
            结算版本、报销单、经费明细与核销分摊均保留审计链路。
          </Typography.Paragraph>
          <Tabs
            activeKey={tab}
            className="ledger-tabs"
            items={tabs.map(([key, label]) => ({
              key,
              label,
              children:
                key === "obligations" ? (
                  <ObligationsPanel />
                ) : key === "claims" ? (
                  <ClaimsPanel user={user} onOpen={setClaimId} />
                ) : key === "reconciliation" ? (
                  <ReconciliationPanel user={user} onOpenClaim={setClaimId} />
                ) : (
                  <LegacyPanel user={user} />
                ),
            }))}
            onChange={(key) => setTab(key as LedgerTab)}
          />
        </Card>
      </div>
      {claimId || creatingClaim ? (
        <ReimbursementClaimDialog
          claimId={claimId}
          user={user}
          onClose={() => {
            setClaimId("");
            setCreatingClaim(false);
          }}
        />
      ) : null}
    </section>
  );
}
