import { Flex, Space } from "antd";
import type { ReactNode } from "react";

export function CommandBar({
  context,
  actions,
  className = "",
  ariaLabel = "工作区操作",
}: {
  context?: ReactNode;
  actions?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Flex
      align="center"
      aria-label={ariaLabel}
      className={`app-command-bar ${className}`.trim()}
      data-ui="workspace-toolbar"
      gap="small"
      justify="space-between"
      role="toolbar"
      wrap
    >
      <div className="app-command-bar-context">{context}</div>
      <Space className="app-command-bar-actions" size={8} wrap>
        {actions}
      </Space>
    </Flex>
  );
}
