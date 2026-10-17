import { Drawer as AntDrawer, type DrawerProps } from "antd";
import { cloneElement, useContext, useState, type ReactElement } from "react";

import { DialogActivityContext } from "../../state/dialogActivity";
import { ModalTransitionContext } from "./modalTransitionContext";

/** Ant remains responsible for drawer motion, portals, focus trapping and reduced motion. */
export function Drawer(props: DrawerProps) {
  const transition = useContext(ModalTransitionContext);
  const parentActive = useContext(DialogActivityContext);
  const open = Boolean(props.open) && (transition?.open ?? true) && parentActive;
  const [retained, setRetained] = useState(props);
  if (open && retained !== props) setRetained(props);
  // Keep the last visual drawer props through Ant's close motion after the parent
  // clears a target or conditionally removes this component.
  const display = open ? props : retained;

  return (
    <DialogActivityContext.Provider value={open}>
      <AntDrawer
        {...display}
        open={open}
        forceRender={display.forceRender || (!open && Boolean(retained.open))}
        afterOpenChange={(nextOpen) => {
          props.afterOpenChange?.(nextOpen);
          if (!nextOpen) {
            transition?.afterClose();
            setRetained(props);
          }
        }}
        drawerRender={(node) => {
          // Ant supplies its drawer container. Inert retires controls without
          // adding an extra layout wrapper, then preserves a caller's renderer.
          const container = cloneElement(node as ReactElement<{ inert?: boolean }>, { inert: !open || undefined });
          return display.drawerRender ? display.drawerRender(container) : container;
        }}
      >
        <ModalTransitionContext.Provider value={null}>{display.children}</ModalTransitionContext.Provider>
      </AntDrawer>
    </DialogActivityContext.Provider>
  );
}
