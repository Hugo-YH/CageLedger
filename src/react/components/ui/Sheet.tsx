import { Popup } from "antd-mobile";
import { type ReactNode } from "react";

export function Sheet({
  children,
  open,
  title,
  onClose,
}: {
  children: ReactNode;
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Popup bodyStyle={{ borderRadius: "12px 12px 0 0" }} position="bottom" visible={open} onMaskClick={onClose}>
      {title ? <div className="app-sheet-title">{title}</div> : null}
      {children}
    </Popup>
  );
}
