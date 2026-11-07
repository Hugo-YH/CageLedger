import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { IntakeBatch, IntakeRecognitionImageInput, IntakeReviewPreview } from "../../../../contracts/intake";
import { previewIntakeReview, type useSaveIntakeBatch } from "../../../api/intake";
import { ApiError } from "../../../api/client";
import { useLatestRequest } from "../../../hooks/useLatestRequest";
import type { IntakeSaveIntent, PendingDuplicateSave } from "../intakeViewTypes";
import { openIntakePrintWindow } from "../intakePrintWindow";

interface MergeState {
  revision: number;
  incoming: IntakeBatch;
  images: IntakeRecognitionImageInput[];
  excludeId?: string;
  intent?: IntakeSaveIntent;
  result: IntakeReviewPreview | null;
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
  snapshotImages = () => [],
  duplicate,
  onSaved,
  onAcknowledge,
  onEdit,
  onCloseReview,
}: {
  revision: RefObject<number>;
  save: Pick<ReturnType<typeof useSaveIntakeBatch>, "mutateAsync">;
  saveInFlight: RefObject<boolean>;
  snapshotImages?: () => IntakeRecognitionImageInput[];
  duplicate?: PendingDuplicateSave | null;
  onSaved: (item: IntakeBatch, intent?: IntakeSaveIntent, popup?: Window | null) => void | Promise<void>;
  onAcknowledge?: () => void;
  onEdit?: (item: IntakeBatch) => void;
  onCloseReview?: () => void;
}) {
  const [state, setState] = useState<MergeState | null>(null);
  const currentState = useRef(state);
  currentState.current = state;
  const requests = useLatestRequest();
  const visible = state?.revision === revision.current ? state : null;
  const previewRequest = useRef<{ controller: AbortController; revision: number } | null>(null);
  const cancelPreview = useCallback(() => {
    previewRequest.current?.controller.abort();
    previewRequest.current = null;
  }, []);
  const currentRevision = revision.current;
  useEffect(() => cancelPreview, [cancelPreview]);
  useEffect(() => {
    if (previewRequest.current && previewRequest.current.revision !== currentRevision) cancelPreview();
  }, [currentRevision, cancelPreview]);
  useEffect(() => {
    if (!duplicate?.details.review || duplicate.intent.draftRevision !== revision.current) return;
    cancelPreview();
    requests.invalidate();
    setState({
      revision: duplicate.intent.draftRevision,
      incoming: duplicate.intent.item,
      images: duplicate.intent.recognitionImages,
      intent: duplicate.intent,
      excludeId: duplicate.intent.exists ? duplicate.intent.item.id : undefined,
      result: duplicate.details.review,
      checking: false,
      error: "",
      saving: false,
      saveError: duplicate.error,
      needsRefresh: false,
    });
  }, [duplicate, revision, cancelPreview, requests]);

  async function load(
    incoming: IntakeBatch,
    excludeId: string | undefined,
    images: IntakeRecognitionImageInput[],
    intent?: IntakeSaveIntent,
  ) {
    cancelPreview();
    const startedRevision = revision.current;
    const controller = new AbortController();
    previewRequest.current = { controller, revision: startedRevision };
    const isCurrentRequest = requests.begin();
    const valid = () => !controller.signal.aborted && isCurrentRequest() && revision.current === startedRevision;
    setState({
      revision: startedRevision,
      incoming,
      images,
      excludeId,
      intent,
      result: null,
      checking: true,
      error: "",
      saving: false,
      saveError: "",
      needsRefresh: false,
    });
    try {
      const result = await previewIntakeReview(incoming, excludeId, images, controller.signal);
      if (valid()) setState((current) => (current ? { ...current, result, checking: false } : null));
    } catch (error) {
      if (valid())
        setState((current) =>
          current
            ? {
                ...current,
                checking: false,
                error: error instanceof Error ? error.message : "预约核对失败，草稿已保留，请重试。",
              }
            : null,
        );
    } finally {
      if (previewRequest.current?.controller === controller) previewRequest.current = null;
    }
  }
  function preview(incoming: IntakeBatch, excludeId?: string) {
    return load(incoming, excludeId, snapshotImages());
  }
  function close() {
    if (currentState.current?.saving || saveInFlight.current) return;
    cancelPreview();
    requests.invalidate();
    setState(null);
    onCloseReview?.();
  }
  function selected(id?: string) {
    const pending = currentState.current;
    if (!pending || pending.revision !== revision.current || pending.checking || pending.saving || saveInFlight.current)
      return null;
    const candidates = pending.result?.items || [];
    const candidate = id
      ? candidates.find((item) => item.item.id === id)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    return candidate ? { pending, candidate } : null;
  }
  function acknowledge(id: string) {
    const choice = selected(id);
    if (!choice?.candidate.canAcknowledge || choice.pending.needsRefresh) return;
    close();
    onAcknowledge?.();
  }
  function edit(id: string) {
    const choice = selected(id);
    if (!choice) return;
    close();
    onEdit?.(choice.candidate.item);
  }
  async function confirm(id?: string) {
    const choice = selected(id);
    if (!choice) return;
    const { pending, candidate } = choice;
    if (pending.needsRefresh || !candidate.canMerge || !candidate.mergedItem || !candidate.confirmationToken) return;
    // Any resumed print still needs its popup opened in this explicit user gesture.
    const popup = pending.intent?.print ? openIntakePrintWindow() : null;
    if (pending.intent?.print && !popup) {
      setState({ ...pending, saveError: "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。" });
      return;
    }
    const isCurrentRequest = requests.begin();
    const valid = () => isCurrentRequest() && revision.current === pending.revision;
    saveInFlight.current = true;
    setState({ ...pending, saving: true, saveError: "" });
    try {
      const response = await save.mutateAsync({
        item: { ...candidate.mergedItem, updatedAt: candidate.item.updatedAt },
        exists: true,
        checkDuplicates: true,
        reviewVersion: 2,
        recognitionImages: pending.images,
        recognitionMerge: {
          reviewVersion: 2,
          incoming: pending.incoming,
          confirmationToken: candidate.confirmationToken,
        },
      });
      if (!valid()) {
        popup?.close();
        return;
      }
      setState(null);
      onCloseReview?.();
      await onSaved(response.item, pending.intent, popup);
    } catch (error) {
      popup?.close();
      if (valid())
        setState({
          ...pending,
          saving: false,
          saveError: error instanceof Error ? error.message : "补充失败，草稿已保留，请重试或重新核对。",
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
    acknowledge,
    edit,
    retry: () => {
      if (visible && !visible.saving) void load(visible.incoming, visible.excludeId, visible.images, visible.intent);
    },
  };
}
