import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomBillingSegment, QuantitySheet, QuantitySheetRow, SessionUser } from "../../../api/contracts";
import { usePrincipalIdentities } from "../../../api/administration";
import { useQuantitySheetPiHistory, useQuantitySheetRooms, useSaveQuantitySheet } from "../../../api/quantitySheets";
import {
  createQuantitySheet,
  createCustomBillingSegment,
  normalizeQuantitySheet,
  roomBillingProfile,
  roomBillingUnit,
  validateQuantitySheet,
} from "../../../../domain/quantitySheets";
import type { QuantityRowHandle } from "../components/QuantityEditorPages";
import {
  todayMonth,
  QUANTITY_ROWS_PER_PAGE,
  makeEditorRows,
  hasRowContent,
  hasExpandedBillingOptions,
} from "../quantitySheetEditorModel";
import { useQuantityIacuc } from "./useQuantityIacuc";

const normalizeIacuc = (value: string) => value.trim().toUpperCase();

export function useQuantitySheetEditor(user: SessionUser, mode: "entry" | "saved", editRequested = false) {
  const [editingDialog, setEditingDialog] = useState(false);
  const metadataEnabled = mode === "entry" || editRequested || editingDialog;
  const roomsQuery = useQuantitySheetRooms(metadataEnabled);
  const identitiesQuery = usePrincipalIdentities(metadataEnabled);
  const rooms = roomsQuery.data?.items || [];
  const [draft, setDraft] = useState(() => createQuantitySheet(todayMonth, user.displayName));
  const peopleEdits = useRef({ code: "", pi: false, owner: false });
  const fillFromIacuc = useCallback(
    (match: { iacuc: string; project?: string; pi?: string; owner?: string; funding?: string }) => {
      const code = normalizeIacuc(match.iacuc);
      const protectedFields =
        peopleEdits.current.code === code ? { ...peopleEdits.current } : { pi: false, owner: false };
      setDraft((current) => ({
        ...current,
        iacuc: match.iacuc,
        project: match.project || current.project,
        pi: protectedFields.pi ? current.pi : match.pi || current.pi,
        owner: protectedFields.owner ? current.owner : match.owner || current.owner,
        funding: match.funding || current.funding,
      }));
    },
    [],
  );
  const iacucLookup = useQuantityIacuc(draft.iacuc, fillFromIacuc);
  const [editorRows, setEditorRows] = useState(() => makeEditorRows(draft));
  const [exists, setExists] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error" | "info">("info");
  const [confirmSave, setConfirmSave] = useState<QuantitySheet | null>(null);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const rowRefs = useRef<Array<QuantityRowHandle | null>>([]);
  const selectedRoom = rooms.find((room) => room.id === draft.roomId);
  const unit = roomBillingUnit(selectedRoom);
  const billingProfile = roomBillingProfile(selectedRoom);
  const animalDetails = unit === "animal_day" || draft.animalDetailEnabled;
  const principalIdentity = identitiesQuery.data?.items.find((item) => item.pi.trim() === draft.pi.trim());
  const freeCageAllowance = Number(principalIdentity?.freeCageAllowance ?? 10);
  const supportsFreeCages = billingProfile.freeAllowance && unit === "cage_day" && freeCageAllowance > 0;
  const supportsTierPriority = billingProfile.tiered && unit === "cage_day";
  const freeCageEnabled =
    supportsFreeCages && (Number(draft.preferredFreeCages || 0) > 0 || draft.freeCagePriority !== null);
  const tierPriorityEnabled = supportsTierPriority && draft.tierCagePriority !== null;
  const { options: iacucOptions, match: iacucMatch } = iacucLookup;
  const piHistory = useQuantitySheetPiHistory(
    iacucMatch?.iacuc || "",
    draft.month,
    mode === "entry" && Boolean(iacucMatch),
  );
  const metadataError = metadataEnabled && (roomsQuery.isError || identitiesQuery.isError);
  const metadataLoading =
    metadataEnabled &&
    !metadataError &&
    (!roomsQuery.data || !identitiesQuery.data) &&
    (roomsQuery.isPending || identitiesQuery.isPending);
  const metadataReady = metadataEnabled && Boolean(roomsQuery.data && identitiesQuery.data) && !metadataError;
  const initialLoading = mode === "entry" && metadataLoading;
  function retryMetadata() {
    if (roomsQuery.isError) void roomsQuery.refetch();
    if (identitiesQuery.isError) void identitiesQuery.refetch();
  }
  const previousPi = piHistory.data?.item?.pi || "";
  const piHint =
    mode === "entry" &&
    Boolean(draft.iacuc.trim()) &&
    Boolean(iacucMatch?.pi) &&
    Boolean(previousPi) &&
    draft.pi.trim() === iacucMatch?.pi.trim() &&
    previousPi.trim() !== iacucMatch?.pi.trim();
  const save = useSaveQuantitySheet();

  const recalculate = useCallback(() => {
    let animals = 0;
    let cages = 0;
    rowRefs.current.forEach((handle) => {
      if (!handle) return;
      const row = handle.getRow();
      const autoAnimals = Math.max(animals + Number(row.addedCount || 0) - Number(row.removedCount || 0), 0);
      animals = row.animalCount == null ? autoAnimals : row.animalCount;
      cages = row.cageCount == null ? (animalDetails ? animals : cages) : row.cageCount;
      handle.setCalculated(animals, cages);
    });
  }, [animalDetails]);

  useEffect(() => {
    recalculate();
  }, [recalculate, editorRows]);

  const customBillingSegmentCount = draft.customBillingSegments.length;

  useEffect(() => {
    if (freeCageEnabled || draft.fullExemption || tierPriorityEnabled || customBillingSegmentCount > 0) {
      setOptionsExpanded(true);
    }
  }, [customBillingSegmentCount, draft.fullExemption, freeCageEnabled, tierPriorityEnabled]);

  function setField<K extends keyof QuantitySheet>(key: K, value: QuantitySheet[K]) {
    if (key === "iacuc") {
      iacucLookup.reset();
      const code = normalizeIacuc(String(value));
      if (peopleEdits.current.code !== code) peopleEdits.current = { code, pi: false, owner: false };
    } else if (key === "pi") {
      peopleEdits.current.pi = true;
    } else if (key === "owner") {
      peopleEdits.current.owner = true;
    }
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setFreeCageEnabled(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      preferredFreeCages: enabled ? current.preferredFreeCages : null,
      freeCagePriority: enabled ? 1 : null,
    }));
  }

  function setFullExemption(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      fullExemption: enabled,
      preferredFreeCages: enabled ? null : current.preferredFreeCages,
      freeCagePriority: enabled ? null : current.freeCagePriority,
      tierCagePriority: enabled ? null : current.tierCagePriority,
    }));
  }

  function setTierPriorityEnabled(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      tierCagePriority: enabled ? 1 : null,
    }));
  }

  function addCustomBillingSegment() {
    setDraft((current) => ({
      ...current,
      customBillingEnabled: true,
      customUnitPrice: null,
      customBillingSegments: [
        ...current.customBillingSegments,
        createCustomBillingSegment(current.month, billingProfile.price),
      ],
    }));
  }

  function updateCustomBillingSegment(id: string, update: Partial<CustomBillingSegment>) {
    setDraft((current) => ({
      ...current,
      customBillingSegments: current.customBillingSegments.map((segment) =>
        segment.id === id ? { ...segment, ...update } : segment,
      ),
    }));
  }

  function removeCustomBillingSegment(id: string) {
    setDraft((current) => {
      const customBillingSegments = current.customBillingSegments.filter((segment) => segment.id !== id);
      return {
        ...current,
        customBillingSegments,
        customBillingEnabled: customBillingSegments.length > 0,
        customUnitPrice: customBillingSegments.length ? current.customUnitPrice : null,
      };
    });
  }

  function chooseRoom(roomId: string) {
    const room = rooms.find((item) => item.id === roomId);
    const billingUnit = roomBillingUnit(room);
    const nextBillingProfile = roomBillingProfile(room);
    setDraft((current) => ({
      ...current,
      roomId,
      roomName: room?.name || "",
      manager: user.displayName,
      roomManager: room?.roomManager || "",
      billingUnit,
      animalDetailEnabled: billingUnit === "animal_day" ? true : current.animalDetailEnabled,
      tierCagePriority: nextBillingProfile.tiered && billingUnit === "cage_day" ? current.tierCagePriority : null,
    }));
  }

  function collectSheet() {
    const snapshot = rowRefs.current
      .map((handle) => handle?.getRow())
      .filter((row): row is QuantitySheetRow => Boolean(row));
    const rows = snapshot.filter(hasRowContent);
    return normalizeQuantitySheet({
      ...draft,
      manager: user.displayName,
      roomManager: selectedRoom?.roomManager || "",
      rows,
      pageCount: Math.max(Math.ceil(snapshot.length / QUANTITY_ROWS_PER_PAGE), 1),
      billingUnit: unit,
      animalDetailEnabled: animalDetails,
      updatedAt: draft.updatedAt,
    });
  }

  function requestSave(event: React.FormEvent) {
    event.preventDefault();
    if (!metadataReady) {
      setNotice("房间或负责人配置尚未就绪，请重试后保存。");
      setNoticeKind("error");
      return;
    }
    const sheet = collectSheet();
    const issues = validateQuantitySheet(sheet);
    if (issues.length) {
      setNotice(issues.slice(0, 4).join("；"));
      setNoticeKind("error");
      return;
    }
    setConfirmSave(sheet);
  }

  async function persistSheet() {
    if (!confirmSave) return;
    if (!metadataReady) {
      setConfirmSave(null);
      setNotice("房间或负责人配置尚未就绪，请重试后保存。");
      setNoticeKind("error");
      return;
    }
    try {
      const response = await save.mutateAsync({ sheet: confirmSave, exists });
      const normalized = normalizeQuantitySheet(response.item);
      const next = createQuantitySheet(normalized.month, user.displayName);
      iacucLookup.reset();
      peopleEdits.current = { code: "", pi: false, owner: false };
      setDraft(next);
      setEditorRows(makeEditorRows(next));
      setExists(false);
      setConfirmSave(null);
      if (mode === "saved") setEditingDialog(false);
      setNotice(
        unit === "cage_day" && !normalized.rows.some((row) => Number(row.animalCount || 0) > 0)
          ? `${normalized.month} · ${normalized.iacuc} 统计表已保存；当前按结余笼数计算饲养费，录入区已清空。`
          : `${normalized.month} · ${normalized.iacuc} 统计表已保存，录入区已清空。`,
      );
      setNoticeKind("success");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
      setNoticeKind("error");
      setConfirmSave(null);
    }
  }

  function startNew() {
    iacucLookup.reset();
    peopleEdits.current = { code: "", pi: false, owner: false };
    const next = createQuantitySheet(todayMonth, user.displayName);
    setDraft(next);
    setEditorRows(makeEditorRows(next));
    setExists(false);
    setNotice("");
    setOptionsExpanded(false);
  }

  function loadForEdit(sheet: QuantitySheet) {
    iacucLookup.reset();
    const next = normalizeQuantitySheet(sheet);
    peopleEdits.current = { code: normalizeIacuc(next.iacuc), pi: true, owner: true };
    setDraft(next);
    setEditorRows(makeEditorRows(next));
    setExists(true);
    setOptionsExpanded(hasExpandedBillingOptions(next));
    if (mode === "saved") setEditingDialog(true);
  }

  function closeEditor() {
    iacucLookup.reset();
    setEditingDialog(false);
  }

  return {
    rooms,
    draft,
    setDraft,
    editorRows,
    setEditorRows,
    notice,
    noticeKind,
    confirmSave,
    setConfirmSave,
    editingDialog,
    optionsExpanded,
    setOptionsExpanded,
    rowRefs,
    selectedRoom,
    unit,
    billingProfile,
    animalDetails,
    freeCageAllowance,
    supportsFreeCages,
    supportsTierPriority,
    freeCageEnabled,
    tierPriorityEnabled,
    iacucLookup,
    iacucOptions,
    iacucMatch,
    piHistory,
    initialLoading,
    metadataLoading,
    metadataError,
    metadataHasData: Boolean(roomsQuery.data && identitiesQuery.data),
    metadataReady,
    retryMetadata,
    previousPi,
    piHint,
    save,
    recalculate,
    customBillingSegmentCount,
    setField,
    setFreeCageEnabled,
    setFullExemption,
    setTierPriorityEnabled,
    addCustomBillingSegment,
    updateCustomBillingSegment,
    removeCustomBillingSegment,
    chooseRoom,
    requestSave,
    persistSheet,
    startNew,
    loadForEdit,
    closeEditor,
  };
}

export type QuantitySheetEditor = ReturnType<typeof useQuantitySheetEditor>;
