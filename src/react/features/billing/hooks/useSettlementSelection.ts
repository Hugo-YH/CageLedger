import { useCallback, useEffect, useRef, useState } from "react";

import { listAllSettlementCandidates } from "../../../api/billing";
import type { SettlementCandidate, SettlementCandidateListParams } from "../../../api/contracts";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

export function useSettlementSelection() {
  const [selectedCandidates, setSelectedCandidates] = useState<SettlementCandidate[]>([]);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const request = useLatestRequest();

  const cancelPending = useCallback(() => {
    if (!controller.current) return;
    controller.current.abort();
    controller.current = null;
    request.invalidate();
    setSelectingAll(false);
    setAllFilteredSelected(false);
  }, [request]);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const clear = useCallback(() => {
    cancelPending();
    setSelectedCandidates([]);
    setAllFilteredSelected(false);
    setError("");
  }, [cancelPending]);

  const toggleAll = useCallback(
    async (params: SettlementCandidateListParams) => {
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
        const items = await listAllSettlementCandidates(params, current.signal);
        if (isCurrent()) setSelectedCandidates(items.filter((item) => item.totalAmount != null));
      } catch (cause) {
        if (isCurrent()) {
          setAllFilteredSelected(false);
          setError(cause instanceof Error ? cause.message : "无法读取全部结算项");
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
    (candidate: SettlementCandidate, checked: boolean) => {
      cancelPending();
      setAllFilteredSelected(false);
      setError("");
      setSelectedCandidates((current) =>
        checked
          ? [...current.filter((item) => item.id !== candidate.id), candidate]
          : current.filter((item) => item.id !== candidate.id),
      );
    },
    [cancelPending],
  );

  const removeCompleted = useCallback(
    (ids: Set<string>) => {
      cancelPending();
      setSelectedCandidates((current) => current.filter((candidate) => !ids.has(candidate.id)));
      setAllFilteredSelected(false);
    },
    [cancelPending],
  );

  return {
    selectedCandidates,
    allFilteredSelected,
    selectingAll,
    error,
    toggleAll,
    toggle,
    clear,
    cancelPending,
    removeCompleted,
  };
}
