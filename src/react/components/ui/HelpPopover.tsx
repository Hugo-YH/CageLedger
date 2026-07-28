import { Button, Popover } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover content={children} title={label} trigger={["hover", "click"]} placement="bottom">
      <Button
        aria-label={label}
        className="app-help-button"
        icon={<QuestionCircleOutlined aria-hidden="true" />}
        shape="circle"
        size="small"
        type="text"
      />
    </Popover>
  );
}
