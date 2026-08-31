import { useCallback, useEffect, useRef, useState } from "react";

import { loadStoredWidths, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, persistColumnWidths } from "./tableColumnWidths";

/** The table is keyed by its persistence identity; changes never write one table's widths into another. */
export function useColumnWidths(resizeKey?: string) {
  const [state, setState] = useState(() => ({ widths: loadStoredWidths(resizeKey), changed: false }));
  const pending = useRef<Record<string, number> | null>(null);

  useEffect(() => {
    if (!resizeKey || !state.changed) return;
    pending.current = state.widths;
    const timer = window.setTimeout(() => {
      persistColumnWidths(resizeKey, state.widths);
      pending.current = null;
    }, 200);
    return () => window.clearTimeout(timer);
  }, [resizeKey, state]);

  useEffect(
    () => () => {
      if (resizeKey && pending.current) persistColumnWidths(resizeKey, pending.current);
    },
    [resizeKey],
  );

  const resize = useCallback((key: string, width: number) => {
    if (!Number.isFinite(width)) return;
    const nextWidth = Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)));
    setState((current) =>
      current.widths[key] === nextWidth ? current : { widths: { ...current.widths, [key]: nextWidth }, changed: true },
    );
  }, []);

  return { widths: state.widths, resize };
}
