import { useCallback, useEffect, useRef, useState } from "react";

import type { IntakeBatch, IntakeBatchListItem, SessionUser } from "../../../api/contracts";
import {
  createIntakeDraft,
  missingIntakeRequiredFields,
  normalizeIntakeBatch,
  updateIntakeDraft,
} from "../../../../domain/intake";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import type { IntakeSaveIntent } from "../intakeViewTypes";
import { useIntakeEditorRead } from "./useIntakeEditorRead";
import { useIntakeRecognition } from "./useIntakeRecognition";

export function useIntakeEditor({
  user,
  mode,
  roomNames,
  roomsReady,
  updateSelection,
}: {
  user: SessionUser;
  mode: "entry" | "batches";
  roomNames: string[];
  roomsReady: boolean;
  updateSelection: (items: IntakeBatchListItem[]) => void;
}) {
  const activeMode = useRef(mode);
  const revision = useRef(0);
  if (activeMode.current !== mode) {
    activeMode.current = mode;
    revision.current += 1;
  }
  const [draft, setDraft] = useState(() => createIntakeDraft(user.displayName, user.phone));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const draftMode = useRef(mode);
  const [fieldErrors, setFieldErrors] = useState<{ roomName?: string; quantity?: string }>({});
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const feedback = useOperationFeedback();
  const invalidate = useCallback(() => {
    revision.current += 1;
  }, []);
  const recognition = useIntakeRecognition(invalidate);
  const { reset: resetRecognition, invalidate: invalidateRecognition } = recognition;
  const editRead = useIntakeEditorRead(
    roomsReady,
    (item) => replaceDraft(normalizeIntakeBatch(item, roomNames), true),
    mode,
  );
  const cancelEditorRead = editRead.cancel;
  useEffect(() => {
    if (draftMode.current === mode) return;
    draftMode.current = mode;
    const fresh = createIntakeDraft(user.displayName, user.phone);
    setDraft(fresh);
    setBaseline(JSON.stringify(fresh));
    setFieldErrors({});
    setNotice("");
  }, [mode, user.displayName, user.phone]);
  useEffect(() => {
    resetRecognition();
    cancelEditorRead();
    setDialogOpen(false);
    setEditing(false);
    return () => {
      revision.current += 1;
      invalidateRecognition();
    };
  }, [mode, resetRecognition, invalidateRecognition, cancelEditorRead]);

  const isCurrent = useCallback(
    (intent: Pick<IntakeSaveIntent, "mode" | "draftRevision">) =>
      activeMode.current === intent.mode && revision.current === intent.draftRevision,
    [],
  );

  function requireRooms() {
    if (roomsReady) return true;
    setNotice("房间信息尚未就绪，请先重试加载。");
    return false;
  }
  function replaceDraft(item: IntakeBatch, accepted = false) {
    recognition.invalidate();
    invalidate();
    setDraft(item);
    setFieldErrors({});
    if (accepted) setBaseline(JSON.stringify(item));
  }
  function update<K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) {
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    recognition.invalidate();
    invalidate();
    setDraft((current) => updateIntakeDraft(current, key, value, roomNames));
  }
  function startNew() {
    recognition.reset();
    replaceDraft(createIntakeDraft(user.displayName, user.phone), true);
    setEditing(false);
    setNotice("");
  }
  function edit(item: IntakeBatchListItem) {
    setBaseline(JSON.stringify(draft));
    recognition.reset();
    invalidate();
    setNotice("");
    editRead.begin(item);
    setEditing(true);
    setDialogOpen(mode === "batches");
  }
  function close() {
    recognition.reset();
    invalidate();
    setDialogOpen(false);
    editRead.cancel();
    setBaseline(JSON.stringify(draft));
  }
  function editReviewed(item: IntakeBatch) {
    editRead.cancel();
    recognition.reset();
    replaceDraft(normalizeIntakeBatch(item, roomNames), true);
    setEditing(true);
    setNotice("正在编辑原预约；本次保存仍会校验原记录版本。");
    setDialogOpen(mode === "batches");
  }
  function prepareSave() {
    if (!requireRooms() || recognition.reading) return null;
    const item = normalizeIntakeBatch(draft, roomNames);
    const missing = missingIntakeRequiredFields(item);
    setFieldErrors({
      ...(missing.includes("房间") ? { roomName: "请选择饲养间" } : {}),
      ...(missing.includes("数量（只）") ? { quantity: "直接取材数量须为大于 0 的整数" } : {}),
    });
    if (missing.length) {
      setNotice(`请填写必填项目：${missing.join("、")}。`);
      requestAnimationFrame(() => {
        const field = document.querySelector<HTMLElement>('#intake-entry-panel [aria-invalid="true"]');
        field?.scrollIntoView({ block: "center" });
        field?.focus();
      });
      return null;
    }
    return item;
  }
  function completeSavedDraft(intent: IntakeSaveIntent, item: IntakeBatch, title?: string) {
    if (!isCurrent(intent)) return;
    recognition.reset();
    if (intent.exists) {
      updateSelection([item]);
      replaceDraft(normalizeIntakeBatch(item, roomNames), true);
      setNotice("");
      feedback.success("待接收批次已更新", item.batchNo);
    } else {
      replaceDraft(createIntakeDraft(user.displayName, user.phone), true);
      setEditing(false);
      setNotice("");
      feedback.success(title || "待接收批次已保存", `${item.batchNo}，可继续录入下一批。`);
    }
  }
  function adoptPrintedDraft(item: IntakeBatch) {
    const saved = normalizeIntakeBatch(item, roomNames);
    recognition.reset();
    replaceDraft(saved, true);
    setEditing(true);
    return saved;
  }
  return {
    draft,
    dirty: JSON.stringify(draft) !== baseline,
    fieldErrors,
    editing,
    dialogOpen,
    revision,
    recognition,
    editRead,
    notice,
    setNotice,
    setDialogOpen,
    isCurrent,
    invalidate,
    requireRooms,
    replaceDraft,
    update,
    startNew,
    edit,
    editReviewed,
    close,
    prepareSave,
    completeSavedDraft,
    adoptPrintedDraft,
  };
}
