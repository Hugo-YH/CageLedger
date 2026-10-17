import { Tag } from "antd";
import { type ReactNode } from "react";
import { tagColors } from "../../../theme/visual-system.mjs";

export type StatusTone = "default" | "processing" | "success" | "warning" | "error";

export function StatusTag({ children, tone = "default" }: { children: ReactNode; tone?: StatusTone }) {
  return (
    <Tag className="app-status-tag" color={tagColors.status[tone]}>
      {children}
    </Tag>
  );
}
