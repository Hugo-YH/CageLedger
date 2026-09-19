import { Button, Popover } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { useState, type ReactNode } from "react";

export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      content={children}
      title={label}
      trigger={["hover", "click"]}
      placement="bottom"
      open={open}
      onOpenChange={setOpen}
      styles={{ root: { maxWidth: "min(384px, 100vw)" }, container: { marginInline: 12 } }}
    >
      <Button
        aria-label={label}
        aria-expanded={open}
        className="app-help-button"
        icon={<QuestionCircleOutlined aria-hidden="true" />}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        shape="circle"
        size="small"
        type="text"
      />
    </Popover>
  );
}
