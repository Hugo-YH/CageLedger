import { Popover, Typography } from "antd";
import { useState, type ReactNode } from "react";

/** Make clipped values readable on touch screens without adding icons to every row. */
export function CellText({
  text,
  fullText = text,
  copyable = false,
}: {
  text: string;
  fullText?: string;
  copyable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const content: ReactNode = (
    <Typography.Paragraph
      style={{ maxWidth: "min(320px, calc(100vw - 64px))", overflowWrap: "anywhere", marginBottom: 0 }}
      copyable={copyable ? { text: fullText, tooltips: ["复制编号", "已复制"] } : false}
    >
      {fullText}
    </Typography.Paragraph>
  );
  if (!copyable && fullText === text && (text.length <= 8 || /^[\d-]+$/.test(text))) {
    return <span className="table-cell-text">{text}</span>;
  }
  return (
    <Popover content={content} open={open} onOpenChange={setOpen} trigger="click">
      <span
        className="table-cell-text"
        role="button"
        tabIndex={0}
        aria-label={`查看完整内容：${fullText}`}
        aria-expanded={open}
        title={fullText}
        style={{ cursor: "pointer" }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        {text}
      </span>
    </Popover>
  );
}
