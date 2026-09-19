import { Button, Space, Tooltip } from "antd";

import type { SettlementCandidate } from "../../../api/contracts";

export function SettlementCandidateActions({
  candidate,
  previewing,
  disabled = false,
  onPreview,
}: {
  candidate: SettlementCandidate;
  previewing: boolean;
  disabled?: boolean;
  onPreview: () => void;
}) {
  const action = (
    <Space size={4} wrap>
      <Button loading={previewing} disabled={disabled || candidate.totalAmount == null} onClick={onPreview}>
        预览结算单
      </Button>
    </Space>
  );
  return candidate.error ? <Tooltip title={candidate.error}>{action}</Tooltip> : action;
}
