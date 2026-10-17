import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { DialogActivityContext } from "../state/dialogActivity";

/** Guard local async effects without cancelling a query shared by other consumers. */
export function useLatestRequest() {
  const active = useContext(DialogActivityContext);
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
  useEffect(() => invalidate, [invalidate]);
  useLayoutEffect(() => {
    activeRef.current = active;
    if (!active) invalidate();
  }, [active, invalidate]);
  return useMemo(() => ({ begin, invalidate }), [begin, invalidate]);
}
