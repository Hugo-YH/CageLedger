import type { SessionUser } from "../../api/contracts";
import { BillingWorkflowPanel } from "./components/BillingWorkflowPanel";

export function WorkflowCenterView({ user }: { user: SessionUser }) {
  return (
    <section className="workspace-view workflow-center-view reimbursement-ledger-view" data-feature="workflow">
      <div className="workspace-body workflow-workspace-body">
        <BillingWorkflowPanel user={user} />
      </div>
    </section>
  );
}
