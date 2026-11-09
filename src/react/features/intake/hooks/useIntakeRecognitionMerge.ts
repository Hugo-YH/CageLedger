import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type {
  IntakeBatch,
  IntakeRecognitionImageInput,
  IntakeReviewPreview,
  IntakeReviewResolution,
  IntakeReviewResolutions,
} from "../../../../contracts/intake";
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
  resolutions: IntakeReviewResolutions;
  resolutionCandidateId?: string;
}

export function useIntakeRecognitionMerge({
  revision,
  save,
  saveInFlight: saveInFlightRef,
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
  const updateState = useCallback((next: MergeState | null) => {
    currentState.current = next;
    setState(next);
  }, []);
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
    updateState({
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
      resolutions: {},
    });
  }, [duplicate, revision, cancelPreview, requests, updateState]);

  async function load(
    incoming: IntakeBatch,
    excludeId: string | undefined,
    images: IntakeRecognitionImageInput[],
    intent?: IntakeSaveIntent,
    review?: {
      result: IntakeReviewPreview | null;
      resolutions: IntakeReviewResolutions;
      resolutionCandidateId?: string;
    },
  ) {
    cancelPreview();
    const startedRevision = revision.current;
    const controller = new AbortController();
    previewRequest.current = { controller, revision: startedRevision };
    const isCurrentRequest = requests.begin();
    const valid = () => !controller.signal.aborted && isCurrentRequest() && revision.current === startedRevision;
    const resolutions = { ...review?.resolutions };
    updateState({
      revision: startedRevision,
      incoming,
      images,
      excludeId,
      intent,
      result: review?.result || null,
      checking: true,
      error: "",
      saving: false,
      saveError: "",
      needsRefresh: false,
      resolutions,
      resolutionCandidateId: review?.resolutionCandidateId,
    });
    try {
      const result = Object.keys(resolutions).length
        ? await previewIntakeReview(incoming, excludeId, images, controller.signal, resolutions)
        : await previewIntakeReview(incoming, excludeId, images, controller.signal);
      if (valid() && currentState.current) updateState({ ...currentState.current, result, checking: false });
    } catch (error) {
      if (valid() && currentState.current)
        updateState({
          ...currentState.current,
          checking: false,
          error: error instanceof Error ? error.message : "预约核对失败，草稿及字段选择已保留，请重试。",
          needsRefresh: true,
        });
    } finally {
      if (previewRequest.current?.controller === controller) previewRequest.current = null;
    }
  }
  function preview(incoming: IntakeBatch, excludeId?: string) {
    return load(incoming, excludeId, snapshotImages());
  }
  function close() {
    if (currentState.current?.saving || saveInFlightRef.current) return;
    cancelPreview();
    requests.invalidate();
    updateState(null);
    onCloseReview?.();
  }
  function selected(id?: string) {
    const pending = currentState.current;
    if (
      !pending ||
      pending.revision !== revision.current ||
      pending.checking ||
      pending.saving ||
      saveInFlightRef.current
    )
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
  function resolveField(id: string, field: string, value: IntakeReviewResolution) {
    const pending = currentState.current;
    if (
      !pending ||
      pending.revision !== revision.current ||
      pending.saving ||
      pending.needsRefresh ||
      saveInFlightRef.current
    )
      return;
    const candidate = pending.result?.items.find((item) => item.item.id === id);
    if (!candidate?.resolutionFields?.includes(field)) return;
    const resolutions = {
      ...(pending.resolutionCandidateId === id ? pending.resolutions : {}),
      [field]: value,
    };
    return load(pending.incoming, pending.excludeId, pending.images, pending.intent, {
      result: pending.result,
      resolutions,
      resolutionCandidateId: id,
    });
  }
  async function confirm(id?: string) {
    const choice = selected(id);
    if (!choice) return;
    const { pending, candidate } = choice;
    if (pending.needsRefresh || !candidate.canMerge || !candidate.mergedItem || !candidate.confirmationToken) return;
    // Any resumed print still needs its popup opened in this explicit user gesture.
    const popup = pending.intent?.print ? openIntakePrintWindow() : null;
    if (pending.intent?.print && !popup) {
      updateState({ ...pending, saveError: "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。" });
      return;
    }
    const isCurrentRequest = requests.begin();
    const valid = () => isCurrentRequest() && revision.current === pending.revision;
    saveInFlightRef.current = true;
    updateState({ ...pending, saving: true, saveError: "" });
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
          ...(Object.keys(pending.resolutions).length ? { resolutions: pending.resolutions } : {}),
        },
      });
      if (!valid()) {
        popup?.close();
        return;
      }
      updateState(null);
      onCloseReview?.();
      await onSaved(response.item, pending.intent, popup);
    } catch (error) {
      popup?.close();
      if (valid())
        updateState({
          ...pending,
          saving: false,
          saveError: error instanceof Error ? error.message : "补充失败，草稿已保留，请重试或重新核对。",
          needsRefresh: error instanceof ApiError && error.status === 409,
        });
    } finally {
      saveInFlightRef.current = false;
    }
  }
  return {
    state: visible,
    preview,
    confirm,
    close,
    acknowledge,
    edit,
    resolveField,
    retry: () => {
      const pending = currentState.current;
      if (pending && pending.revision === revision.current && !pending.saving && !saveInFlightRef.current)
        void load(pending.incoming, pending.excludeId, pending.images, pending.intent, {
          result: pending.result,
          resolutions: pending.resolutions,
          resolutionCandidateId: pending.resolutionCandidateId,
        });
    },
  };
}
