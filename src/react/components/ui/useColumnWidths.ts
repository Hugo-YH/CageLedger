import { useCallback, useEffect, useRef, useState } from "react";

import { loadStoredWidths, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, persistColumnWidths } from "./tableColumnWidths";

/** The table is keyed by its persistence identity; changes never write one table's widths into another. */
export function useColumnWidths(resizeKey?: string) {
  const [state, setState] = useState(() => ({ widths: loadStoredWidths(resizeKey), changed: false }));
  const pending = useRef<Record<string, number> | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!resizeKey || !state.changed) return;
    pending.current = state.widths;
    timer.current = window.setTimeout(() => {
      persistColumnWidths(resizeKey, state.widths);
      pending.current = null;
      timer.current = null;
    }, 200);
    return () => {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [resizeKey, state]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (resizeKey && pending.current) persistColumnWidths(resizeKey, pending.current);
      pending.current = null;
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
