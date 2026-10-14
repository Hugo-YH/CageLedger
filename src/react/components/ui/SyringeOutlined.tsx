import Icon from "@ant-design/icons";
import type { ComponentProps } from "react";

/** Shared outline icon for technical services; menu text supplies the accessible name. */
export function SyringeOutlined(props: Omit<ComponentProps<typeof Icon>, "component" | "children" | "viewBox">) {
  return (
    <Icon aria-hidden="true" {...props} viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="m13 6 5 5-8 8-5-5Z" />
        <path d="m5 14-1 5 5-1M4 19l-2 2M15.5 8.5 19 5M17 3l5 5M11.5 4.5l8 8M10 9l2 2M8 11l2 2" />
      </g>
    </Icon>
  );
}
