import { useState } from "react";
import { AuditOutlined } from "@ant-design/icons";
import { Button, Card, Space, Tabs, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import { ClaimsPanel, LegacyPanel, ObligationsPanel, ReconciliationPanel } from "./components/ReimbursementLedger";
import { ReimbursementClaimDialog } from "./components/ReimbursementClaimDialog";

type LedgerTab = "obligations" | "claims" | "reconciliation" | "legacy";

const tabs: Array<[LedgerTab, string]> = [
  ["obligations", "结算应收"],
  ["claims", "报销单"],
  ["reconciliation", "核销中心"],
  ["legacy", "历史台账"],
];

export function WorkflowCenterView({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<LedgerTab>("obligations");
  const [claimId, setClaimId] = useState("");
  const [creatingClaim, setCreatingClaim] = useState(false);

  return (
    <section className="workspace-view workflow-center-view reimbursement-ledger-view" data-feature="workflow">
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
