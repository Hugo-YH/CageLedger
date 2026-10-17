import { useContext, useMemo, useState, type ReactElement } from "react";

import { DialogActivityContext } from "../../state/dialogActivity";
import { ModalTransitionContext } from "./modalTransitionContext";

function sameDialog(left: ReactElement, right: ReactElement) {
  return left.type === right.type && left.key === right.key;
}

/** Keep a conditional dialog mounted through Ant's exit; replace keyed dialogs after exit. */
export function ModalPresence({ children }: { children: ReactElement | null | false }) {
  const parentActive = useContext(DialogActivityContext);
  const next = children || null;
  const [state, setState] = useState({ requested: next, rendered: next, exiting: false, cycle: 0 });
  if (state.requested !== next) {
    const same = next && state.rendered && sameDialog(state.rendered, next);
    const exiting = Boolean(state.rendered && (state.exiting || !same));
    setState({ ...state, requested: next, rendered: exiting ? state.rendered : next, exiting });
  }
  const open = Boolean(state.rendered && !state.exiting);
  const transition = useMemo(
    () => ({
      open,
      afterClose: () => {
        if (!open) setState({ requested: next, rendered: next, exiting: false, cycle: state.cycle + 1 });
      },
    }),
    [next, open, state.cycle],
  );

  return (
    <ModalTransitionContext.Provider key={state.cycle} value={transition}>
      <DialogActivityContext.Provider value={parentActive && open}>{state.rendered}</DialogActivityContext.Provider>
    </ModalTransitionContext.Provider>
  );
}
