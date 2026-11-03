import { useRef, useState, type RefObject } from "react";

import type { IntakeBatch, IntakeRecognitionMergePreview } from "../../../../contracts/intake";
import { previewIntakeRecognitionMerge, type useSaveIntakeBatch } from "../../../api/intake";
import { ApiError } from "../../../api/client";
import { useLatestRequest } from "../../../hooks/useLatestRequest";

interface MergeState {
  revision: number;
  incoming: IntakeBatch;
  excludeId?: string;
  result: IntakeRecognitionMergePreview | null;
  checking: boolean;
  error: string;
  saving: boolean;
  saveError: string;
  needsRefresh: boolean;
}

export function useIntakeRecognitionMerge({
  revision,
  save,
  saveInFlight,
  onSaved,
}: {
  revision: RefObject<number>;
  save: Pick<ReturnType<typeof useSaveIntakeBatch>, "mutateAsync">;
  saveInFlight: RefObject<boolean>;
  onSaved: (item: IntakeBatch) => void;
}) {
  const [state, setState] = useState<MergeState | null>(null);
  const currentState = useRef(state);
  currentState.current = state;
  const requests = useLatestRequest();
  const visible = state?.revision === revision.current ? state : null;

  async function preview(incoming: IntakeBatch, excludeId?: string) {
    if (!incoming.batchNo.trim() && !incoming.purchaseOrderNo.trim()) {
      requests.invalidate();
      setState(null);
      return;
    }
    const startedRevision = revision.current;
    const isCurrentRequest = requests.begin();
    const valid = () => isCurrentRequest() && revision.current === startedRevision;
    setState({
      revision: startedRevision,
      incoming,
      excludeId,
      result: null,
      checking: true,
      error: "",
      saving: false,
      saveError: "",
      needsRefresh: false,
    });
    try {
      const result = await previewIntakeRecognitionMerge(incoming, excludeId);
      if (valid()) setState((current) => (current ? { ...current, result, checking: false } : null));
    } catch (error) {
      if (valid())
        setState((current) =>
          current
            ? {
                ...current,
                checking: false,
                error: error instanceof Error ? error.message : "已有预约匹配失败，识别草稿已保留，请重试。",
              }
            : null,
        );
    }
  }

  function close() {
    if (currentState.current?.saving) return;
    requests.invalidate();
    setState(null);
  }

  async function confirm() {
    const pending = currentState.current;
    const candidate = pending?.result?.items[0];
    if (
      !pending ||
      pending.revision !== revision.current ||
      pending.checking ||
      pending.saving ||
      pending.needsRefresh ||
      saveInFlight.current ||
      pending.result?.total !== 1 ||
      pending.result.items.length !== 1 ||
      !candidate?.canMerge ||
      !candidate.mergedItem ||
      !candidate.confirmationToken
    )
      return;
    const isCurrentRequest = requests.begin();
    const valid = () => isCurrentRequest() && revision.current === pending.revision;
    saveInFlight.current = true;
    setState({ ...pending, saving: true, saveError: "" });
    try {
      const response = await save.mutateAsync({
        item: candidate.mergedItem,
        exists: true,
        checkDuplicates: true,
        recognitionMerge: { incoming: pending.incoming, confirmationToken: candidate.confirmationToken },
      });
      if (!valid()) return;
      setState(null);
      onSaved(response.item);
    } catch (error) {
      if (valid())
        setState({
          ...pending,
          saving: false,
          saveError: error instanceof Error ? error.message : "合并保存失败，文字识别草稿已保留，可重试或重新匹配。",
          needsRefresh: error instanceof ApiError && error.status === 409,
        });
    } finally {
      saveInFlight.current = false;
    }
  }

  return {
    state: visible,
    preview,
    confirm,
    close,
    retry: () => {
      if (visible && !visible.saving) void preview(visible.incoming, visible.excludeId);
    },
  };
}
