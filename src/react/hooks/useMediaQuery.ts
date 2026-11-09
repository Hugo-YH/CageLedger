import { useCallback, useMemo, useSyncExternalStore } from "react";

/** A media preference stays live without rebuilding listeners on unrelated renders. */
export function useMediaQuery(query: string) {
  const media = useMemo(() => (typeof window.matchMedia === "function" ? window.matchMedia(query) : null), [query]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      media?.addEventListener("change", onChange);
      return () => media?.removeEventListener("change", onChange);
    },
    [media],
  );
  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false,
  );
}
