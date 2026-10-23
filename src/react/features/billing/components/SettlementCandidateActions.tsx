import { Button, Space, Tooltip } from "antd";
import { useContext } from "react";
import { SettlementPreviewContext } from "./settlementPreviewContext";

import type { SettlementCandidate } from "../../../api/contracts";

export function SettlementCandidateActions({
  candidate,
  disabled = false,
}: {
  candidate: SettlementCandidate;
  disabled?: boolean;
}) {
  const controller = useContext(SettlementPreviewContext);
  if (!controller) throw new Error("SettlementCandidateActions requires SettlementPreviewProvider");
  const action = (
    <Space size={4} wrap>
      <Button
        loading={controller.previewingId === candidate.id}
        disabled={disabled || controller.pending || candidate.totalAmount == null}
        onClick={(event) => controller.open(candidate, event.currentTarget)}
      >
        预览结算单
      </Button>
    </Space>
  );
  return candidate.error ? <Tooltip title={candidate.error}>{action}</Tooltip> : action;
}
