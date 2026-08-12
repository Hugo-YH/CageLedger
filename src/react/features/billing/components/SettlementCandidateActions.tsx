import { EyeOutlined } from "@ant-design/icons";
import { Button, Space, Tooltip } from "antd";

import type { SettlementCandidate } from "../../../api/contracts";

export function SettlementCandidateActions({
  candidate,
  previewing,
  onPreview,
}: {
  candidate: SettlementCandidate;
  previewing: boolean;
  onPreview: () => void;
}) {
  const action = (
    <Space size={4} wrap>
      <Button
        icon={<EyeOutlined aria-hidden />}
        loading={previewing}
        size="small"
        disabled={candidate.totalAmount == null}
        onClick={onPreview}
      >
        预览结算单
      </Button>
    </Space>
  );
  return candidate.error ? <Tooltip title={candidate.error}>{action}</Tooltip> : action;
}
