import { Modal } from "antd";
import { type ReactNode } from "react";

export function Dialog({
  children,
  open,
  title,
  onClose,
  footer,
  width = 720,
}: {
  children: ReactNode;
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number | string;
}) {
  return (
    <Modal centered footer={footer} open={open} title={title} width={width} onCancel={onClose}>
      {children}
    </Modal>
  );
}
