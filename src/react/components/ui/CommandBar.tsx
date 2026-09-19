import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Spin, Typography } from "antd";
import { useRef, type ReactNode } from "react";
import { useCommandBarSticky } from "../../hooks/useCommandBarSticky";

export type LowFrequencyAction = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
};

export type CommandBarProps = {
  context?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;
  lowFrequencyActions?: LowFrequencyAction[];
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
  lowFrequencyActions = [],
  selection,
  className = "",
  ariaLabel = "工作区操作",
  sticky = false,
}: CommandBarProps) {
  const moreActionsRef = useRef<HTMLButtonElement>(null);
  const stickyRequested = sticky === "selection" ? Boolean(selection?.count || selection?.pending) : sticky;
  const ref = useCommandBarSticky(stickyRequested);
  return (
    <>
      {filters ? (
        <div className="app-command-bar-filters" role="group" aria-label={`${ariaLabel}筛选`}>
          {filters}
        </div>
      ) : null}
      {context || actions || primaryAction || selection || lowFrequencyActions.length ? (
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
            {lowFrequencyActions.length ? (
              <Dropdown
                menu={{
                  items: lowFrequencyActions.map((action) => ({
                    key: action.key,
                    danger: action.danger,
                    disabled: action.disabled || action.loading,
                    icon: action.loading ? <Spin size="small" /> : action.icon,
                    label: action.label,
                  })),
                  onClick: ({ key }) => {
                    moreActionsRef.current?.focus();
                    lowFrequencyActions.find((action) => action.key === String(key))?.onClick();
                  },
                }}
                trigger={["click"]}
              >
                <Button aria-label={`${ariaLabel}更多操作`} icon={<MoreOutlined aria-hidden />} ref={moreActionsRef}>
                  更多
                </Button>
              </Dropdown>
            ) : null}
            {primaryAction}
          </Space>
        </div>
      ) : null}
    </>
  );
}
