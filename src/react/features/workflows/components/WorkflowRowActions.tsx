import type { ReactNode } from "react";
import { RowActions, type LowFrequencyAction } from "../../../components/ui";

export function WorkflowRowActions({
  primary,
  lock,
  lowFrequencyActions,
}: {
  primary: ReactNode;
  lock?: ReactNode;
  lowFrequencyActions?: LowFrequencyAction[];
}) {
  return (
    <RowActions ariaLabel="结算流程更多操作" lowFrequencyActions={lowFrequencyActions}>
      {primary}
      {lock}
    </RowActions>
  );
}
