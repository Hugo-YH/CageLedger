import { type ReactNode } from "react";

import { Drawer } from "./Drawer";

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
    <Drawer closable={false} onClose={onClose} open={open} placement="bottom" size="auto">
      {title ? <div className="app-sheet-title">{title}</div> : null}
      {children}
    </Drawer>
  );
}
