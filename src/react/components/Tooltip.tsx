import { Button, Popover, Tooltip as AntTooltip } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { type ReactNode, useId } from "react";

/**
 * Unified anchored help layer. Ant portals overlays to the document body and
 * applies viewport collision handling for desktop and touch layouts.
 */
export function Tooltip({
  children,
  content,
  id,
  className = "",
  tapToToggle = false,
}: {
  children: ReactNode;
  content: ReactNode;
  id?: string;
  className?: string;
  tapToToggle?: boolean;
}) {
  const overlay = <span id={id}>{content}</span>;
  const trigger = <span className={`tooltip-anchor ${className}`.trim()}>{children}</span>;
  return tapToToggle ? (
    <Popover content={overlay} destroyOnHidden placement="bottom" trigger="click">
      {trigger}
    </Popover>
  ) : (
    <AntTooltip destroyOnHidden placement="top" title={overlay}>
      {trigger}
    </AntTooltip>
  );
}

export function HelpTooltip({ children, label }: { children: ReactNode; label: string }) {
  const id = useId();
  return (
    <Popover content={children} destroyOnHidden placement="bottom" title={label} trigger={["hover", "click"]}>
      <Button
        aria-describedby={id}
        aria-label={label}
        className="inspection-help-trigger"
        icon={<QuestionCircleOutlined aria-hidden="true" />}
        shape="circle"
        size="small"
        type="text"
      />
    </Popover>
  );
}
