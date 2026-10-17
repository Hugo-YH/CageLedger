import { Modal as AntModal, type ModalProps } from "antd";
import { cloneElement, useContext, useState, type ReactElement } from "react";

import { DialogActivityContext } from "../../state/dialogActivity";
import { ModalTransitionContext } from "./modalTransitionContext";

/** Ant remains responsible for motion, portals, focus trapping and reduced motion. */
export function Modal(props: ModalProps) {
  const transition = useContext(ModalTransitionContext);
  const parentActive = useContext(DialogActivityContext);
  const open = Boolean(props.open) && (transition?.open ?? true) && parentActive;
  const [retained, setRetained] = useState(props);
  if (open && retained !== props) setRetained(props);
  // Closing often clears the target and draft in the parent. Keep the last visual
  // props until Ant finishes leaving, without postponing the business callback.
  const display = open ? props : retained;

  return (
    <DialogActivityContext.Provider value={open}>
      <AntModal
        {...display}
        open={open}
        forceRender={display.forceRender || (!open && Boolean(retained.open))}
        afterClose={() => {
          props.afterClose?.();
          transition?.afterClose();
          setRetained(props);
        }}
        afterOpenChange={props.afterOpenChange}
        modalRender={(node) => {
          // Ant supplies its container element. Inert keeps retiring controls out
          // of both pointer and keyboard interaction without adding a layout box.
          const container = cloneElement(node as ReactElement<{ inert?: boolean }>, { inert: !open || undefined });
          return display.modalRender ? display.modalRender(container) : container;
        }}
      >
        <ModalTransitionContext.Provider value={null}>{display.children}</ModalTransitionContext.Provider>
      </AntModal>
    </DialogActivityContext.Provider>
  );
}
