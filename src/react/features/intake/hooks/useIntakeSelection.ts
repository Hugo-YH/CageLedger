import { useCallback, useEffect, useRef, useState } from "react";

import { listAllIntakeBatches } from "../../../api/intake";
import type { IntakeBatch, IntakeListParams } from "../../../api/contracts";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

export function useIntakeSelection() {
  const [selectedItems, setSelectedItems] = useState<IntakeBatch[]>([]);
  const [selectingAll, setSelectingAll] = useState(false);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const request = useLatestRequest();

  const cancelPending = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    request.invalidate();
    setSelectingAll(false);
    setAllFilteredSelected(false);
  }, [request]);
  useEffect(() => () => controller.current?.abort(), []);

  const clear = useCallback(() => {
    cancelPending();
    setSelectedItems([]);
    setError("");
  }, [cancelPending]);

  const toggleAll = useCallback(
    async (params: IntakeListParams) => {
      if (controller.current || allFilteredSelected) {
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
        const items = await listAllIntakeBatches(params, current.signal);
        if (isCurrent()) setSelectedItems(items);
      } catch (cause) {
        if (isCurrent()) {
          setAllFilteredSelected(false);
          setError(cause instanceof Error ? cause.message : "无法读取全部待接收批次");
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
    (item: IntakeBatch, checked: boolean) => {
      cancelPending();
      setError("");
      setSelectedItems((current) =>
        checked
          ? [...current.filter((selected) => selected.id !== item.id), item]
          : current.filter((selected) => selected.id !== item.id),
      );
    },
    [cancelPending],
  );

  const remove = useCallback(
    (id: string) => {
      cancelPending();
      setSelectedItems((current) => current.filter((item) => item.id !== id));
    },
    [cancelPending],
  );

  return { selectedItems, selectingAll, allFilteredSelected, error, clear, toggleAll, toggle, remove };
}
