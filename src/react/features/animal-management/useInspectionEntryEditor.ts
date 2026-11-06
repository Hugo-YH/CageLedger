import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InspectionAnswer, InspectionCatalogNode, InspectionModuleCode } from "../../api/contracts";
import {
  useAnimalInspectionEdit,
  useAnimalInspectionCatalog,
  useSaveAnimalInspection,
  useSubmitAnimalInspection,
  useRefreshAnimalInspections,
} from "../../api/animalManagement";
import { useRooms } from "../../api/infrastructure";
import { useOperationFeedback } from "../../hooks/useOperationFeedback";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { uploadInspectionPhotos } from "./inspectionPhotoUploads";
import { applyInspectionAnswerPatch, applyInspectionOutcomeToNodes } from "./inspectionAnswerUpdates";
import { inspectionAnswerKey, resumeInspectionId, setResumeInspectionId } from "./model";

export function useInspectionEntryEditor() {
  const feedback = useOperationFeedback();
  const [draftId, setDraftId] = useState(resumeInspectionId);
  const [facility, setFacility] = useState("");
  const [roomId, setRoomId] = useState("");
  const [modules, setModules] = useState<InspectionModuleCode[]>(["basicAssessment"]);
  const [answers, setAnswers] = useState<Record<string, InspectionAnswer>>({});
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [operationError, setOperationError] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<Array<{ inspectionId: string; findingId: string; file: File }>>(
    [],
  );
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const operationLock = useRef(false);
  const [initializedId, setInitializedId] = useState("");
  const lastSaved = useRef<{ id: string; updatedAt: string; fingerprint: string } | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const catalog = useAnimalInspectionCatalog();
  const bootstrap = useRooms();
  const detail = useAnimalInspectionEdit(draftId, !busy && initializedId !== draftId);
  const save = useSaveAnimalInspection();
  const submit = useSubmitAnimalInspection();
  const refresh = useRefreshAnimalInspections();
  const snapshot = useMemo(
    () => ({
      roomId,
      moduleCodes: [...modules],
      answers: Object.values(answers)
        .map((answer) => ({ ...answer }))
        .sort((a, b) =>
          inspectionAnswerKey(a.moduleCode, a.nodeCode).localeCompare(inspectionAnswerKey(b.moduleCode, b.nodeCode)),
        ),
    }),
    [roomId, modules, answers],
  );
  const fingerprint = JSON.stringify(snapshot);
  useUnsavedChanges(
    (Boolean(roomId) && fingerprint !== savedFingerprint) ||
      pendingPhotos.length > 0 ||
      Object.values(photos).some((files) => files.length > 0),
    busy || uploadingPhotos,
  );
  const rooms = useMemo(
    () => (bootstrap.data?.items || []) as Array<{ id: string; name: string; facility?: string }>,
    [bootstrap.data?.items],
  );
  const facilities = [...new Set(rooms.map((room) => String(room.facility || "").trim()).filter(Boolean))].sort();
  const facilityRooms = rooms.filter((room) => room.facility === facility);
  const catalogNodes = catalog.data?.nodes || [];

  useEffect(() => {
    const item = detail.data?.item;
    if (!item || item.id !== draftId || initializedId === item.id || detail.isFetching || detail.isError) return;
    setInitializedId(item.id);
    setFacility(item.facility || "");
    setRoomId(item.roomId);
    setModules(item.moduleCodes);
    const next: Record<string, InspectionAnswer> = {};
    for (const answer of detail.data!.answers) {
      const source = answer.payload || answer;
      next[inspectionAnswerKey(source.moduleCode || answer.module_code, source.nodeCode || answer.node_code)] = {
        nodeCode: source.nodeCode || answer.node_code,
        moduleCode: source.moduleCode || answer.module_code,
        outcome: source.outcome,
        score: source.score,
        subOption: source.subOption,
        note: source.note,
        locationHint: source.locationHint,
        rackHint: source.rackHint,
        cageNumber: source.cageNumber,
        animalIdentifier: source.animalIdentifier,
      };
    }
    setAnswers(next);
    const baseline = JSON.stringify({
      roomId: item.roomId,
      moduleCodes: [...item.moduleCodes],
      answers: Object.values(next).sort((a, b) =>
        inspectionAnswerKey(a.moduleCode, a.nodeCode).localeCompare(inspectionAnswerKey(b.moduleCode, b.nodeCode)),
      ),
    });
    lastSaved.current = { id: item.id, updatedAt: item.updatedAt, fingerprint: baseline };
    setSavedFingerprint(baseline);
  }, [detail.data, detail.isFetching, detail.isError, draftId, initializedId]);

  useEffect(() => {
    if (facility || !roomId) return;
    const room = rooms.find((item) => item.id === roomId);
    if (room?.facility) setFacility(room.facility);
  }, [facility, roomId, rooms]);

  function setModule(code: InspectionModuleCode, checked: boolean) {
    setModules((current) => {
      if (checked) return [...current, code];
      return current.filter((item) => item !== code);
    });
  }

  const updateAnswer = useCallback((node: InspectionCatalogNode, patch: Partial<InspectionAnswer>) => {
    setAnswers((items) => applyInspectionAnswerPatch(items, node, patch));
  }, []);

  const markNodesNormal = useCallback((nodes: InspectionCatalogNode[]) => {
    setAnswers((items) => applyInspectionOutcomeToNodes(items, nodes, "normal"));
  }, []);

  async function persistSnapshot(frozen: typeof snapshot, deferInvalidate: boolean) {
    const response = await save.mutateAsync({
      id: draftId || undefined,
      ...frozen,
      expectedUpdatedAt: lastSaved.current?.id === draftId ? lastSaved.current.updatedAt : undefined,
      deferInvalidate,
    });
    const saved = { id: response.item.id, updatedAt: response.item.updatedAt, fingerprint: JSON.stringify(frozen) };
    lastSaved.current = saved;
    setInitializedId(saved.id);
    setSavedFingerprint(saved.fingerprint);
    setDraftId(saved.id);
    setResumeInspectionId(saved.id);
    return saved;
  }

  async function saveDraft() {
    if (operationLock.current || (draftId && initializedId !== draftId)) return;
    operationLock.current = true;
    setBusy(true);
    setOperationError("");
    try {
      await persistSnapshot(snapshot, false);
      feedback.success("巡检草稿已保存", "可在巡检记录中继续编辑。");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "保存巡检草稿失败");
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }

  async function uploadPhotos(items: Array<{ inspectionId: string; findingId: string; file: File }>) {
    setUploadingPhotos(true);
    try {
      const failed = await uploadInspectionPhotos(items);
      setPendingPhotos(failed);
      const failedItems = new Set(failed);
      const uploaded = new Set(items.filter((item) => !failedItems.has(item)).map((item) => item.file));
      setPhotos((current) =>
        Object.fromEntries(
          Object.entries(current)
            .map(([key, files]) => [key, files.filter((file) => !uploaded.has(file))] as const)
            .filter(([, files]) => files.length > 0),
        ),
      );
      return failed.length;
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function retryPhotos() {
    if (operationLock.current || !pendingPhotos.length) return;
    operationLock.current = true;
    setBusy(true);
    const key = `inspection:${pendingPhotos[0].inspectionId}:submission`;
    try {
      const failed = await uploadPhotos([...pendingPhotos]);
      if (!failed) feedback.success("巡检照片已补传", undefined, key);
      else feedback.warning("巡检照片未全部上传", `${failed} 张照片仍保留在当前页面，可重试上传。`, key);
    } finally {
      await refresh();
      operationLock.current = false;
      setBusy(false);
    }
  }

  async function submitInspection() {
    if (operationLock.current || pendingPhotos.length || (draftId && initializedId !== draftId)) return;
    operationLock.current = true;
    setBusy(true);
    setOperationError("");
    try {
      const frozen = snapshot;
      const frozenPhotos = Object.entries(photos).map(([key, files]) => [key, [...files]] as const);
      const previous = lastSaved.current;
      const saved =
        previous?.id === draftId && previous.fingerprint === JSON.stringify(frozen)
          ? previous
          : await persistSnapshot(frozen, true);
      const id = saved.id;
      const response = await submit.mutateAsync({ id, expectedUpdatedAt: saved.updatedAt, deferInvalidate: true });
      const findingsByNode = new Map(
        response.findings.map((finding) => [`${finding.moduleCode}:${finding.nodeCode}`, finding]),
      );
      const uploads = frozenPhotos.flatMap(([key, files]) =>
        files.map((file) => ({
          inspectionId: id,
          findingId: findingsByNode.get(key)?.id || "",
          file,
        })),
      );
      const failed = await uploadPhotos(uploads);
      setResumeInspectionId("");
      setDraftId("");
      setInitializedId("");
      lastSaved.current = null;
      setSavedFingerprint(saved.fingerprint);
      if (failed)
        feedback.warning(
          "巡检已提交，照片未全部上传",
          `已生成 ${response.findings.length} 项异常处置项；${failed} 张照片保留在当前页面，可重试上传。`,
          `inspection:${id}:submission`,
        );
      else
        feedback.success(
          "巡检已提交",
          `已生成 ${response.findings.length} 项异常处置项。`,
          `inspection:${id}:submission`,
        );
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "提交巡检失败");
    } finally {
      await refresh();
      operationLock.current = false;
      setBusy(false);
    }
  }

  return {
    draftId,
    facility,
    setFacility,
    roomId,
    setRoomId,
    modules,
    setModules,
    setModule,
    answers,
    setPhotos,
    operationError,
    pendingPhotos,
    uploadingPhotos,
    busy,
    catalog,
    bootstrap,
    detail,
    save,
    submit,
    rooms,
    facilities,
    facilityRooms,
    catalogNodes,
    updateAnswer,
    markNodesNormal,
    saveDraft,
    retryPhotos,
    submitInspection,
    ready: !draftId || initializedId === draftId,
  };
}
