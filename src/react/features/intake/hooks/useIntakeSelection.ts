import { useCallback, useEffect, useRef, useState } from "react";

import { listAllIntakeBatchSummaries } from "../../../api/intake";
import type { IntakeBatchListItem, IntakeListParams } from "../../../api/contracts";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

export function useIntakeSelection() {
  const [selectedItems, setSelectedItems] = useState<IntakeBatchListItem[]>([]);
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
        const items = await listAllIntakeBatchSummaries(params, current.signal);
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
    (item: IntakeBatchListItem, checked: boolean) => {
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

  const update = useCallback(
    (items: IntakeBatchListItem[]) => {
      if (controller.current) cancelPending();
      const byId = new Map(items.map((item) => [item.id, item]));
      setSelectedItems((current) => current.map((item) => byId.get(item.id) ?? item));
    },
    [cancelPending],
  );

  return { selectedItems, selectingAll, allFilteredSelected, error, clear, toggleAll, toggle, remove, update };
}
