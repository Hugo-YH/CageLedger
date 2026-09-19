import { useCallback, useEffect, useRef, useState } from "react";

import type { QuantitySheetListParams } from "../../../api/contracts";
import { listAllQuantitySheets } from "../../../api/quantitySheets";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

export function useQuantitySheetSelection() {
  const [selected, setSelected] = useState<string[]>([]);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const request = useLatestRequest();

  const cancelPending = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    request.invalidate();
    setSelectingAll(false);
  }, [request]);

  useEffect(() => () => controller.current?.abort(), []);

  const clear = useCallback(() => {
    cancelPending();
    setSelected([]);
    setAllFilteredSelected(false);
    setError("");
  }, [cancelPending]);

  const toggleAll = useCallback(
    async (params: QuantitySheetListParams) => {
      if (controller.current) return;
      if (allFilteredSelected) {
        clear();
        return;
      }
      const isCurrent = request.begin();
      const current = new AbortController();
      controller.current = current;
      setSelectingAll(true);
      setAllFilteredSelected(true);
      setError("");
      try {
        const items = await listAllQuantitySheets(params, current.signal);
        if (isCurrent()) setSelected(items.map((item) => item.id));
      } catch (cause) {
        if (isCurrent()) {
          setAllFilteredSelected(false);
          setError(cause instanceof Error ? cause.message : "无法读取全部统计表");
        }
      } finally {
        if (isCurrent()) {
          controller.current = null;
          setSelectingAll(false);
        }
      }
    },
    [allFilteredSelected, clear, request],
  );

  const toggle = useCallback(
    (id: string, checked: boolean) => {
      cancelPending();
      setAllFilteredSelected(false);
      setError("");
      setSelected((current) =>
        checked ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id),
      );
    },
    [cancelPending],
  );

  return { selected, allFilteredSelected, selectingAll, error, toggleAll, toggle, clear };
}
