import { AuditOutlined } from "@ant-design/icons";
import { Card, Space, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import { BillingWorkflowPanel } from "./components/BillingWorkflowPanel";

export function WorkflowCenterView({ user }: { user: SessionUser }) {
  return (
    <section className="workspace-view workflow-center-view reimbursement-ledger-view" data-feature="workflow">
      <div className="workspace-body workflow-workspace-body">
        <Card
          className="reimbursement-ledger-panel"
          title={
            <Space size={8}>
              <AuditOutlined />
              <Typography.Title level={2} style={{ margin: 0 }}>
                单据跟踪
              </Typography.Title>
            </Space>
          }
        >
          <Typography.Paragraph className="reimbursement-ledger-description" type="secondary">
            以饲养费结算单为主线：发起结算流程、交回登记、归档。
          </Typography.Paragraph>
          <BillingWorkflowPanel user={user} />
        </Card>
      </div>
    </section>
  );
}
