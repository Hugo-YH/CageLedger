import { useCallback, useEffect, useMemo, useRef } from "react";

/** Guard local async effects without cancelling a query shared by other consumers. */
export function useLatestRequest() {
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current += 1;
  }, []);
  const begin = useCallback(() => {
    const request = ++generation.current;
    return () => generation.current === request;
  }, []);
  useEffect(() => invalidate, [invalidate]);
  return useMemo(() => ({ begin, invalidate }), [begin, invalidate]);
}
