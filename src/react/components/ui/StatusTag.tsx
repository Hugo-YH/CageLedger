import { Tag } from "antd";
import { type ReactNode } from "react";

export type StatusTone = "default" | "processing" | "success" | "warning" | "error";

const colorByTone: Record<StatusTone, string | undefined> = {
  default: undefined,
  processing: "processing",
  success: "success",
  warning: "warning",
  error: "error",
};

export function StatusTag({ children, tone = "default" }: { children: ReactNode; tone?: StatusTone }) {
  return (
    <Tag className="app-status-tag" color={colorByTone[tone]}>
      {children}
    </Tag>
  );
}
