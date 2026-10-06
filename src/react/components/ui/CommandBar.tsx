import { ActionIcon } from "./ActionIcon";
import { ExclamationCircleOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Spin, Typography } from "antd";
import { useRef, type ReactElement, type ReactNode } from "react";
import { useCommandBarSticky } from "../../hooks/useCommandBarSticky";
import { HelpPopover } from "./HelpPopover";

export type LowFrequencyAction = {
  key: string;
  label: ReactNode;
  icon: ReactElement;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
};

export type CommandBarProps = {
  title?: ReactNode;
  description?: ReactNode;
  titleSize?: "page" | "section";
  titleLevel?: 1 | 2 | 3 | 4 | 5;
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
  title,
  description,
  titleSize = "page",
  titleLevel = titleSize === "page" ? 2 : 3,
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
  const filterContent = filters ? (
    <div className="app-command-bar-filters" role="group" aria-label={`${ariaLabel}筛选`}>
      {filters}
    </div>
  ) : null;
  const barContent =
    title || context || actions || primaryAction || selection || lowFrequencyActions.length ? (
      <div
        ref={ref}
        aria-label={ariaLabel}
        className={`app-command-bar ${className}`.trim()}
        data-ui="workspace-toolbar"
        data-title-size={title ? titleSize : undefined}
        role="group"
      >
        <div className="app-command-bar-context">
          {title ? (
            <div className="app-command-bar-heading">
              <Typography.Title
                level={titleLevel}
                className={`app-command-bar-title app-command-bar-title-${titleSize}`}
              >
                {title}
              </Typography.Title>
            </div>
          ) : null}
          {title && description ? (
            <HelpPopover
              label={`${typeof title === "string" ? title : ariaLabel}说明`}
              icon={<ExclamationCircleOutlined aria-hidden="true" />}
            >
              {description}
            </HelpPopover>
          ) : null}
          {context}
          {selection ? (
            <Typography.Text aria-live="polite">
              {`已选 ${selection.count} 项`}
              {selection.pending ? " · 正在处理…" : ""}
            </Typography.Text>
          ) : null}
        </div>
        <Space className="app-command-bar-actions" size={8} wrap>
          {selection ? (
            <Button
              icon={<ActionIcon name="clear" />}
              disabled={!selection.count && !selection.pending}
              onClick={selection.onClear}
            >
              清空选择
            </Button>
          ) : null}
          {actions}
          {lowFrequencyActions.length === 1 ? (
            <Button
              danger={lowFrequencyActions[0].danger}
              disabled={lowFrequencyActions[0].disabled || lowFrequencyActions[0].loading}
              icon={lowFrequencyActions[0].icon}
              loading={lowFrequencyActions[0].loading}
              onClick={lowFrequencyActions[0].onClick}
            >
              {lowFrequencyActions[0].label}
            </Button>
          ) : lowFrequencyActions.length > 1 ? (
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
    ) : null;
  return (
    <>
      {title ? (
        <>
          {barContent}
          {filterContent}
        </>
      ) : (
        <>
          {filterContent}
          {barContent}
        </>
      )}
    </>
  );
}
