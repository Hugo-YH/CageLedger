import { Empty, Typography } from "antd";
import type { ReactNode } from "react";

/** Shared empty-state hierarchy; callers retain ownership of recovery actions. */
export function EmptyState({ title, detail, action }: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <Empty
      data-ui="empty-state"
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div className="app-empty-state-content">
          <Typography.Text strong>{title}</Typography.Text>
          {detail != null && detail !== false ? (
            <Typography.Paragraph type="secondary">{detail}</Typography.Paragraph>
          ) : null}
        </div>
      }
    >
      {action}
    </Empty>
  );
}
