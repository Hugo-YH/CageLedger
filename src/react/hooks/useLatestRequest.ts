import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from "react";

import { DialogActivityContext } from "../state/dialogActivity";

/** Guard local async effects without cancelling a query shared by other consumers. */
export function useLatestRequest(enabled = true) {
  const dialogActive = useContext(DialogActivityContext);
  const active = dialogActive && enabled;
  const activeRef = useRef(active);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current += 1;
  }, []);
  const begin = useCallback(() => {
    const request = ++generation.current;
    const startedActive = activeRef.current;
    return () => startedActive && activeRef.current && generation.current === request;
  }, []);
  useLayoutEffect(() => invalidate, [invalidate]);
  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active) invalidate();
  }, [active, invalidate]);
  return useMemo(() => ({ begin, invalidate }), [begin, invalidate]);
}
