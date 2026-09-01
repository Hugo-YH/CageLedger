import type { ReactNode } from "react";

export function WorkflowRowActions({
  primary,
  revoke,
  lock,
}: {
  primary: ReactNode;
  revoke?: ReactNode;
  lock?: ReactNode;
}) {
  return (
    <div className="workflow-row-actions">
      <span className="workflow-row-action-slot">{primary}</span>
      <span aria-hidden={!revoke} className="workflow-row-action-slot">
        {revoke}
      </span>
      <span aria-hidden={!lock} className="workflow-row-action-slot">
        {lock}
      </span>
    </div>
  );
}
