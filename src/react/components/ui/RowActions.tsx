import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Spin } from "antd";
import { useRef, type ReactNode } from "react";

import type { LowFrequencyAction } from "./CommandBar";

export function RowActions({
  children,
  lowFrequencyActions = [],
  ariaLabel = "行更多操作",
}: {
  children?: ReactNode;
  lowFrequencyActions?: LowFrequencyAction[];
  ariaLabel?: string;
}) {
  const moreActionsRef = useRef<HTMLButtonElement>(null);
  return (
    <Space className="table-actions" size={4}>
      {children}
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
          <Button aria-label={ariaLabel} icon={<MoreOutlined aria-hidden />} ref={moreActionsRef} size="small">
            更多
          </Button>
        </Dropdown>
      ) : null}
    </Space>
  );
}
