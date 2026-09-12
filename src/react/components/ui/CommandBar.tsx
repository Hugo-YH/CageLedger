import { Button, Space, Typography } from "antd";
import type { ReactNode } from "react";
import { useCommandBarSticky } from "../../hooks/useCommandBarSticky";

export type CommandBarProps = {
  context?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;
  selection?: { count: number; onClear: () => void; pending?: boolean };
  className?: string;
  ariaLabel?: string;
  sticky?: boolean | "selection";
};

export function CommandBar({
  context,
  filters,
  actions,
  primaryAction,
  selection,
  className = "",
  ariaLabel = "工作区操作",
  sticky = false,
}: CommandBarProps) {
  const stickyRequested = sticky === "selection" ? Boolean(selection?.count || selection?.pending) : sticky;
  const ref = useCommandBarSticky(stickyRequested);
  return (
    <>
      {filters ? (
        <div className="app-command-bar-filters" role="group" aria-label={`${ariaLabel}筛选`}>
          {filters}
        </div>
      ) : null}
      {context || actions || primaryAction || selection ? (
        <div
          ref={ref}
          aria-label={ariaLabel}
          className={`app-command-bar ${className}`.trim()}
          data-ui="workspace-toolbar"
          role="group"
        >
          <div className="app-command-bar-context">
            {context}
            {selection ? (
              <Space size={8} wrap>
                <Typography.Text aria-live="polite">
                  {`已选 ${selection.count} 项`}
                  {selection.pending ? " · 正在处理…" : ""}
                </Typography.Text>
                <Button disabled={!selection.count && !selection.pending} onClick={selection.onClear}>
                  清空选择
                </Button>
              </Space>
            ) : null}
          </div>
          <Space className="app-command-bar-actions" size={8} wrap>
            {actions}
            {primaryAction}
          </Space>
        </div>
      ) : null}
    </>
  );
}
