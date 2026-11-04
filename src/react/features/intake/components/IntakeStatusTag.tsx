import { Tag } from "antd";

import type { IntakeBatchStatus } from "../../../api/contracts";
import { intakeStatusLabel } from "../../../../domain/intake";

/** The same intake state keeps its existing color in lists, forms and options. */
export function IntakeStatusTag({ status }: { status: IntakeBatchStatus }) {
  const color =
    status === "received"
      ? "green"
      : status === "printed"
        ? "blue"
        : status === "pending_print" || status === "pending_receipt"
          ? "gold"
          : "default";
  return <Tag color={color}>{intakeStatusLabel(status)}</Tag>;
}
