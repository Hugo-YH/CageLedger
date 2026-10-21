import { ActionIcon } from "../../components/ui/ActionIcon";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type {
  IntakeBatch,
  IntakeDuplicateDetails,
  IntakeListParams,
  IntakeWriteResponse,
  SessionUser,
} from "../../api/contracts";
import {
  aiParseIntakeMessage,
  intakeDuplicateDetails,
  standardizeIntakeStrain,
  useConfirmIntakeBatchesReceipt,
  useDeleteIntakeBatch,
  useIntakeBatches,
  useMarkIntakeBatchesPrinted,
  useSaveIntakeBatch,
} from "../../api/intake";
import { fetchIacucSearch } from "../../api/iacuc";
import { queryKeys } from "../../api/queryKeys";
import { ActionButton, ModalPresence } from "../../components/ui";
import { useSelectionScope } from "../../hooks/useSelectionScope";
import { useIntakeSelection } from "./hooks/useIntakeSelection";
import { AsyncActionButton, ModalShell, PageSkeleton, WorkspaceToolbar } from "../../components/WorkspaceUi";
import {
  createIntakeDraft,
  missingIntakeRequiredFields,
  normalizeIntakeBatch,
  parseIntakeMessage,
  updateIntakeDraft,
  isDirectSampling,
  canConfirmIntakeReceipt,
  abbreviateSupplier,
} from "../../../domain/intake";
import {
  openIntakeCardPrint,
  planIntakeCardPrint,
  type IntakeCardPrintKind,
  type IntakePrintRoom,
} from "../../print/intakeCards";
import { IntakeBatchList, IntakeEntryPanel } from "./components/IntakePanels";
import { IntakeDuplicateConfirmDialog } from "./components/IntakeDuplicateConfirmDialog";
import type { WorkspaceView } from "../../state/ui";

interface PendingIntakePrintJob {
  batches: IntakeBatch[];
  kind: IntakeCardPrintKind;
  cardCount: number;
  pageSize: number;
  missing: number;
  saveCurrent: boolean;
  exists: boolean;
  draftRevision: number;
}

interface IntakeSaveIntent {
  item: IntakeBatch;
  exists: boolean;
  draftRevision: number;
  mode: "entry" | "batches";
  print?: { job: PendingIntakePrintJob; fillBlanks: boolean };
}

interface PendingDuplicateSave {
  intent: IntakeSaveIntent;
  details: IntakeDuplicateDetails;
  error: string;
}

export function IntakeView({
  user,
  mode,
}: {
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
  mode: "entry" | "batches";
}) {
  const activeMode = useRef(mode);
  const draftRevision = useRef(0);
  const saveInFlight = useRef(false);
  const duplicateConfirmationInFlight = useRef(false);
  if (activeMode.current !== mode) {
    activeMode.current = mode;
    draftRevision.current += 1;
  }
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap("summary");
  const roomNames = bootstrap.data?.rooms.map((room) => String(room.name || "")).filter(Boolean) || [];
  const printRooms: IntakePrintRoom[] =
    bootstrap.data?.rooms.map((room) => ({
      name: String(room.name || ""),
      facility: String(room.facility || ""),
    })) || [];
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [aiParsing, setAiParsing] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "intakeDate", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const selection = useIntakeSelection();
  const { selectedItems, selectingAll, allFilteredSelected } = selection;
  const [draft, setDraft] = useState(() => createIntakeDraft(user.displayName, user.phone));
  const [editing, setEditing] = useState(false);
  const [editingDialog, setEditingDialog] = useState(false);
  const [notice, setNotice] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkNoticeKind, setBulkNoticeKind] = useState<"success" | "error" | "info">("info");
  const [markingPrinted, setMarkingPrinted] = useState(false);
  const [markingReceived, setMarkingReceived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IntakeBatch | null>(null);
  const [pendingPrint, setPendingPrint] = useState<PendingIntakePrintJob | null>(null);
  const [pendingDuplicateSave, setPendingDuplicateSave] = useState<PendingDuplicateSave | null>(null);
  const params: IntakeListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useIntakeBatches(params, mode === "batches");
  const save = useSaveIntakeBatch();
  const remove = useDeleteIntakeBatch();
  const markBatchesPrinted = useMarkIntakeBatchesPrinted();
  const confirmBatchesReceipt = useConfirmIntakeBatchesReceipt();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const selectedPrintPlan = planIntakeCardPrint(selectedItems, printRooms);
  const selectionScope = JSON.stringify([
    mode,
    Object.entries(filters)
      .filter(([, values]) => values.length)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, [...values].sort()]),
  ]);
  useSelectionScope(
    selectionScope,
    () => {
      selection.clear();
      setPendingPrint((current) => (current?.saveCurrent ? current : null));
      setDeleteTarget(null);
    },
    selectedItems.length > 0 || selectingAll,
  );
  useEffect(() => {
    setPendingDuplicateSave(null);
    return () => {
      draftRevision.current += 1;
    };
  }, [mode]);

  if (bootstrap.isPending || (mode === "batches" && list.isPending)) {
    return (
      <PageSkeleton
        label={mode === "entry" ? "笼卡接收" : "待接收批次"}
        variant={mode === "entry" ? "form" : "table"}
      />
    );
  }

  function update<K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) {
    draftRevision.current += 1;
    setPendingDuplicateSave(null);
    setDraft((current) => updateIntakeDraft(current, key, value, roomNames));
  }

  function replaceDraft(next: IntakeBatch) {
    draftRevision.current += 1;
    setPendingDuplicateSave(null);
    setDraft(next);
  }

  function invalidateDraftConfirmation() {
    draftRevision.current += 1;
    setPendingDuplicateSave(null);
  }

  function closeEditingDialog() {
    invalidateDraftConfirmation();
    setEditingDialog(false);
  }

  function isCurrentSaveIntent(intent: IntakeSaveIntent) {
    return activeMode.current === intent.mode && draftRevision.current === intent.draftRevision;
  }

  function saveIntent(item: IntakeBatch, exists: boolean, print?: IntakeSaveIntent["print"]): IntakeSaveIntent {
    return { item, exists, draftRevision: draftRevision.current, mode, print };
  }

  function showSaveFailure(intent: IntakeSaveIntent, error: unknown, fallback: string) {
    if (!isCurrentSaveIntent(intent)) return;
    const details = intakeDuplicateDetails(error);
    if (details) {
      setPendingDuplicateSave({ intent, details, error: "" });
      return;
    }
    setNotice(error instanceof Error ? error.message : fallback);
  }

  function completeSavedDraft(intent: IntakeSaveIntent, savedItem: IntakeBatch) {
    if (!isCurrentSaveIntent(intent)) return false;
    if (intent.exists) {
      selection.update([savedItem]);
      replaceDraft(normalizeIntakeBatch(savedItem, roomNames));
      setNotice("待接收批次已更新。");
      return true;
    }
    replaceDraft(createIntakeDraft(user.displayName, user.phone));
    setEditing(false);
    setNotice(`待接收批次 ${savedItem.batchNo} 已保存，可继续录入下一批。`);
    return true;
  }

  async function parseMessage() {
    let parsed = parseIntakeMessage(draft.rawMessage, user.displayName, roomNames);
    if (parsed.strainRaw && parsed.strainStandard === parsed.strainRaw) {
      const result = await standardizeIntakeStrain(parsed.strainRaw);
      parsed = { ...parsed, strainStandard: result.item || parsed.strainStandard };
    }
    const info = await applyParsedMessage(parsed);
    setNotice(recognitionNotice(info));
  }

  async function aiParseMessage() {
    setAiParsing(true);
    try {
      const response = await aiParseIntakeMessage(draft.rawMessage, roomNames);
      const info = await applyParsedMessage(response.item);
      const tokens = response.usage?.total_tokens;
      const usageText = typeof tokens === "number" && tokens > 0 ? `，本次 AI 识别消耗 ${tokens} tokens` : "";
      setNotice(`预约消息已识别（AI）${usageText}${info.strainNote}，请核对批次信息。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 识别失败，请重试。");
    } finally {
      setAiParsing(false);
    }
  }

  function recognitionNotice(info: { batchNo: boolean; strainNote: string }) {
    return info.batchNo
      ? `预约消息已识别，请核对批次信息${info.strainNote}。`
      : `未识别到完整批次号，请手动补充${info.strainNote}。`;
  }

  async function applyParsedMessage(parsed: Partial<IntakeBatch>) {
    const normalized = normalizeIntakeBatch(
      { ...parsed, supplier: abbreviateSupplier(parsed.supplier || ""), rawMessage: draft.rawMessage },
      roomNames,
    );
    const normalizedCode = String(parsed.iacuc || "")
      .trim()
      .toUpperCase();
    let match: { project?: string; pi?: string; owner?: string } | undefined;
    if (normalizedCode) {
      const result = await queryClient.ensureQueryData({
        queryKey: queryKeys.iacucSearch(normalizedCode, 1),
        queryFn: ({ signal }) => fetchIacucSearch(normalizedCode, 1, signal),
        staleTime: 5 * 60_000,
      });
      match = result.items[0];
    }
    // Only an explicit edit from the saved-batch list retains the persisted batch ID.
    const isEditingSavedBatch = mode === "batches" && editing;
    replaceDraft(
      normalizeIntakeBatch(
        {
          ...draft,
          ...normalized,
          id: isEditingSavedBatch ? draft.id : String(normalized.id || draft.id),
          receiverName: normalized.receiverName || (isEditingSavedBatch ? draft.receiverName : user.displayName),
          vetPhone: normalized.vetPhone || (isEditingSavedBatch ? draft.vetPhone : user.phone),
          project: match?.project || normalized.project,
          pi: match?.pi || normalized.pi,
          owner: match?.owner || normalized.owner,
        },
        roomNames,
      ),
    );
    const strainRaw = String(normalized.strainRaw || "").trim();
    const strainStandard = String(normalized.strainStandard || "").trim();
    const strainNote =
      strainRaw && strainStandard && strainRaw !== strainStandard ? `，品系已按 MGI 标准化为 ${strainStandard}` : "";
    return { batchNo: Boolean(normalized.batchNo), strainNote };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const item = normalizeIntakeBatch(draft, roomNames);
    const missingFields = missingIntakeRequiredFields(item);
    if (missingFields.length) {
      setNotice(`请填写必填项目：${missingFields.join("、")}。`);
      return;
    }
    const isEditingSavedBatch = mode === "batches" && editing;
    const intent = saveIntent(item, isEditingSavedBatch);
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      const response = await save.mutateAsync({ item, exists: isEditingSavedBatch, checkDuplicates: true });
      completeSavedDraft(intent, response.item);
    } catch (error) {
      showSaveFailure(intent, error, "保存失败");
    } finally {
      saveInFlight.current = false;
    }
  }

  function startNew() {
    replaceDraft(createIntakeDraft(user.displayName, user.phone));
    setEditing(false);
    setNotice("");
  }

  function edit(item: IntakeBatch) {
    replaceDraft(normalizeIntakeBatch(item, roomNames));
    setEditing(true);
    setEditingDialog(mode === "batches");
  }

  async function markPrinted(targets: IntakeBatch[]) {
    const printable = targets.filter(
      (item) => !isDirectSampling(item) && (item.status === "pending_print" || item.status === "draft"),
    );
    if (!printable.length) {
      setBulkNotice("选中的批次均未处于待打印状态，无需标记已打印。");
      setBulkNoticeKind("info");
      return;
    }
    setMarkingPrinted(true);
    setBulkNotice(`正在标记 ${printable.length} 个批次为已打印…`);
    setBulkNoticeKind("info");
    try {
      const response = await markBatchesPrinted.mutateAsync(printable.map((item) => item.id));
      selection.update(response.items);
      const skipped = targets.length - printable.length;
      setBulkNotice(
        skipped
          ? `已标记 ${printable.length} 个批次为已打印；${skipped} 个无需打印或非待打印批次跳过。`
          : `已标记 ${printable.length} 个批次为已打印。`,
      );
      setBulkNoticeKind("success");
    } catch (error) {
      setBulkNotice(error instanceof Error ? error.message : "标记已打印失败");
      setBulkNoticeKind("error");
    } finally {
      setMarkingPrinted(false);
    }
  }

  function printCurrentBatch() {
    const item = normalizeIntakeBatch(draft, roomNames);
    if (isDirectSampling(item)) {
      setNotice("直接取材批次无需打印笼卡。");
      return;
    }
    const missingFields = missingIntakeRequiredFields(item);
    if (missingFields.length) {
      setNotice(`打印前请填写必填项目：${missingFields.join("、")}。`);
      return;
    }
    if (!item.quantity || item.quantity <= 0 || item.finalCardCount <= 0) {
      setNotice("打印前请填写动物数量和打印张数。");
      return;
    }
    requestPrint([item], true, editing);
  }

  function requestPrint(targets: IntakeBatch[], saveCurrent = false, exists = false) {
    const plan = planIntakeCardPrint(targets, printRooms);
    if (plan.disabledReason) {
      if (saveCurrent) setNotice(plan.disabledReason);
      else {
        setBulkNotice(plan.disabledReason);
        setBulkNoticeKind("info");
      }
      return;
    }
    const job: PendingIntakePrintJob = {
      batches: targets,
      kind: plan.kind as IntakeCardPrintKind,
      cardCount: plan.cardCount,
      pageSize: plan.pageSize,
      missing: plan.missing,
      saveCurrent,
      exists,
      draftRevision: draftRevision.current,
    };
    if (job.missing) {
      setPendingPrint(job);
      return;
    }
    void executePrint(job, false);
  }

  function openPrintWindow() {
    const popup = window.open("", "_blank");
    if (!popup) return null;
    popup.document.write(
      '<!doctype html><html lang="zh-CN"><head><title>正在准备笼卡</title></head><body>正在准备笼卡...</body></html>',
    );
    popup.document.close();
    return popup;
  }

  async function executePrint(job: PendingIntakePrintJob, fillBlanks: boolean) {
    setPendingPrint(null);
    if (job.saveCurrent && draftRevision.current !== job.draftRevision) return;
    const popup = openPrintWindow();
    if (!popup) {
      const message = "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。";
      if (job.saveCurrent) setNotice(message);
      else {
        setBulkNotice(message);
        setBulkNoticeKind("error");
      }
      return;
    }
    let printable = job.batches;
    try {
      if (job.saveCurrent) {
        const intent: IntakeSaveIntent = {
          item: job.batches[0],
          exists: job.exists,
          draftRevision: job.draftRevision,
          mode,
          print: { job, fillBlanks },
        };
        if (!isCurrentSaveIntent(intent)) {
          popup.close();
          return;
        }
        if (saveInFlight.current) {
          popup.close();
          return;
        }
        saveInFlight.current = true;
        let response: IntakeWriteResponse;
        try {
          response = await save.mutateAsync({ item: intent.item, exists: intent.exists, checkDuplicates: true });
        } finally {
          saveInFlight.current = false;
        }
        if (!isCurrentSaveIntent(intent)) {
          popup.close();
          return;
        }
        const saved = normalizeIntakeBatch(response.item, roomNames);
        replaceDraft(saved);
        setEditing(true);
        printable = [saved];
      }
      if (openIntakeCardPrint(printable, { kind: job.kind, fillBlanks, targetWindow: popup })) {
        await markPrinted(printable);
      }
    } catch (error) {
      popup.close();
      if (job.saveCurrent) {
        const intent: IntakeSaveIntent = {
          item: job.batches[0],
          exists: job.exists,
          draftRevision: job.draftRevision,
          mode,
          print: { job, fillBlanks },
        };
        const details = intakeDuplicateDetails(error);
        if (details && isCurrentSaveIntent(intent)) {
          setPendingDuplicateSave({ intent, details, error: "" });
          return;
        }
        if (!isCurrentSaveIntent(intent)) return;
      }
      const message = error instanceof Error ? error.message : "准备笼卡失败";
      if (job.saveCurrent) setNotice(message);
      else {
        setBulkNotice(message);
        setBulkNoticeKind("error");
      }
    }
  }

  async function confirmDuplicateSave() {
    const pending = pendingDuplicateSave;
    if (!pending || saveInFlight.current || duplicateConfirmationInFlight.current) return;
    if (!isCurrentSaveIntent(pending.intent)) {
      setPendingDuplicateSave(null);
      return;
    }
    duplicateConfirmationInFlight.current = true;
    const popup = pending.intent.print ? openPrintWindow() : null;
    if (pending.intent.print && !popup) {
      duplicateConfirmationInFlight.current = false;
      setPendingDuplicateSave({ ...pending, error: "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。" });
      return;
    }
    try {
      saveInFlight.current = true;
      const response = await save.mutateAsync({
        item: pending.intent.item,
        exists: pending.intent.exists,
        checkDuplicates: true,
        duplicateConfirmation: pending.details.confirmationToken,
      });
      if (!isCurrentSaveIntent(pending.intent)) {
        popup?.close();
        return;
      }
      setPendingDuplicateSave(null);
      if (!pending.intent.print) {
        completeSavedDraft(pending.intent, response.item);
        return;
      }
      const saved = normalizeIntakeBatch(response.item, roomNames);
      replaceDraft(saved);
      setEditing(true);
      if (
        openIntakeCardPrint([saved], {
          kind: pending.intent.print.job.kind,
          fillBlanks: pending.intent.print.fillBlanks,
          targetWindow: popup,
        })
      ) {
        await markPrinted([saved]);
      } else {
        popup?.close();
      }
    } catch (error) {
      popup?.close();
      if (!isCurrentSaveIntent(pending.intent)) return;
      const details = intakeDuplicateDetails(error);
      if (details) {
        setPendingDuplicateSave({ intent: pending.intent, details, error: "重复记录已更新，请重新核对后确认保存。" });
        return;
      }
      setPendingDuplicateSave({
        ...pending,
        error: error instanceof Error ? error.message : "确认保存失败，请重试。",
      });
    } finally {
      saveInFlight.current = false;
      duplicateConfirmationInFlight.current = false;
    }
  }

  async function receive(targets: IntakeBatch[]) {
    const printable = targets.filter(canConfirmIntakeReceipt);
    if (!printable.length) {
      setBulkNotice("请选择已打印的入驻饲养批次或待接收的直接取材批次。");
      setBulkNoticeKind("info");
      return;
    }
    setMarkingReceived(true);
    setBulkNotice(`正在标记 ${printable.length} 个批次为已接收…`);
    setBulkNoticeKind("info");
    try {
      const response = await confirmBatchesReceipt.mutateAsync({ ids: printable.map((item) => item.id) });
      selection.update(response.batches);
      const skipped = targets.length - printable.length;
      setBulkNotice(
        skipped
          ? `已标记 ${printable.length} 个批次为已接收；${skipped} 个不符合接收条件的批次跳过。`
          : `已标记 ${printable.length} 个批次为已接收。`,
      );
      setBulkNoticeKind("success");
    } catch (error) {
      setBulkNotice(error instanceof Error ? error.message : "标记已接收失败");
      setBulkNoticeKind("error");
    } finally {
      setMarkingReceived(false);
    }
  }

  function toggleSort(key: string) {
    setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
    setPage(1);
  }

  return (
    <section className="workspace-view intake-workspace react-intake-view" data-feature="intake">
      <div className="workspace-body intake-workspace-body">
        <section className="billing-layout quantity-billing-layout intake-layout">
          {mode === "entry" ? (
            <WorkspaceToolbar
              ariaLabel="笼卡录入操作"
              title={isDirectSampling(draft) ? "直接取材预约" : editing ? "编辑接收笼卡" : "接收笼卡"}
              sticky
              actions={
                <ActionButton icon={<ActionIcon name="create" />} disabled={save.isPending} onClick={startNew}>
                  新建批次
                </ActionButton>
              }
              primaryAction={
                <AsyncActionButton
                  icon={<ActionIcon name="save" />}
                  className="primary"
                  type="submit"
                  form="intake-entry-panel"
                  pending={save.isPending}
                  pendingLabel="保存中..."
                >
                  保存待接收批次
                </AsyncActionButton>
              }
            />
          ) : null}
          {mode === "entry" ? (
            <IntakeEntryPanel
              editing={editing}
              draft={draft}
              roomNames={roomNames}
              notice={notice}
              saving={save.isPending}
              aiPending={aiParsing}
              onSubmit={submit}
              headActions={null}
              onAiParse={aiParseMessage}
              onParse={parseMessage}
              onPrint={() => void printCurrentBatch()}
              onUpdate={update}
            />
          ) : (
            <IntakeBatchList
              total={total}
              selectedItems={selectedItems}
              items={items}
              loading={list.isFetching}
              selectingAll={selectingAll}
              allFilteredSelected={allFilteredSelected}
              bulkNotice={selection.error || bulkNotice}
              bulkNoticeKind={selection.error ? "error" : bulkNoticeKind}
              markingPrinted={markingPrinted}
              markingReceived={markingReceived}
              printDisabledReason={selectedPrintPlan.disabledReason}
              page={page}
              pageSize={pageSize}
              params={params}
              filters={filters}
              onClearSelection={selection.clear}
              onToggleAll={() => void selection.toggleAll(params)}
              onToggleItem={selection.toggle}
              onSort={toggleSort}
              onFilter={(key, values) => {
                setFilters((current) => ({ ...current, [key]: values }));
                setPage(1);
              }}
              onPrint={(targets) => requestPrint(targets)}
              onMarkPrinted={(targets) => void markPrinted(targets)}
              onReceive={(targets) => void receive(targets)}
              onEdit={edit}
              onDelete={setDeleteTarget}
              onPage={setPage}
              onPageSize={(value) => {
                setPageSize(value);
                setPage(1);
              }}
            />
          )}
        </section>
      </div>
      <ModalPresence>
        {editingDialog ? (
          <ModalShell
            key={draft.id}
            ariaLabel="编辑待接收批次"
            className="intake-edit-modal"
            onClose={closeEditingDialog}
          >
            <div className="modal-shell-head">
              <div>
                <h2>编辑待接收批次</h2>
                <p>{draft.batchNo}</p>
              </div>
              <ActionButton onClick={closeEditingDialog}>关闭</ActionButton>
            </div>
            <div className="modal-shell-body">
              <IntakeEntryPanel
                editing={editing}
                draft={draft}
                roomNames={roomNames}
                notice={notice}
                saving={save.isPending}
                aiPending={aiParsing}
                onSubmit={submit}
                headActions={
                  <ActionButton icon={<ActionIcon name="save" />} loading={save.isPending} tone="primary" type="submit">
                    保存待接收批次
                  </ActionButton>
                }
                onAiParse={aiParseMessage}
                onParse={parseMessage}
                onPrint={() => void printCurrentBatch()}
                onUpdate={update}
              />
            </div>
          </ModalShell>
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {deleteTarget ? (
          <ModalShell key={deleteTarget.id} ariaLabel="删除待接收批次" onClose={() => setDeleteTarget(null)}>
            <div className="modal-shell-head">
              <div>
                <h2 id="delete-intake-title">删除待接收批次</h2>
                <p>{deleteTarget.batchNo}</p>
              </div>
            </div>
            <div className="modal-shell-body">
              <p>删除后，该批次及关联的待进驻任务会一并移除。</p>
            </div>
            <div className="modal-shell-actions">
              <ActionButton onClick={() => setDeleteTarget(null)}>取消</ActionButton>
              <ActionButton
                disabled={remove.isPending}
                loading={remove.isPending}
                tone="destructive"
                onClick={async () => {
                  await remove.mutateAsync(deleteTarget.id);
                  selection.remove(deleteTarget.id);
                  setDeleteTarget(null);
                }}
              >
                确认删除
              </ActionButton>
            </div>
          </ModalShell>
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {pendingPrint ? (
          <IntakePrintConfirmDialog
            key={pendingPrint.batches.map((batch) => batch.id).join(",")}
            job={pendingPrint}
            onClose={() => setPendingPrint(null)}
            onPrint={(fillBlanks) => void executePrint(pendingPrint, fillBlanks)}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {pendingDuplicateSave ? (
          <IntakeDuplicateConfirmDialog
            key={pendingDuplicateSave.details.confirmationToken}
            details={pendingDuplicateSave.details}
            error={pendingDuplicateSave.error}
            pending={save.isPending}
            onClose={invalidateDraftConfirmation}
            onConfirm={() => void confirmDuplicateSave()}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}

function IntakePrintConfirmDialog({
  job,
  onClose,
  onPrint,
}: {
  job: PendingIntakePrintJob;
  onClose: () => void;
  onPrint: (fillBlanks: boolean) => void;
}) {
  return (
    <ModalShell ariaLabel="补齐空白笼卡" className="intake-print-confirm-modal" onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2>补齐空白笼卡</h2>
          <p>{job.kind === "temporary" ? "8014 临时饲养间版式" : "普通饲养间版式"}</p>
        </div>
        <ActionButton aria-label="关闭" onClick={onClose}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body">
        <p>
          当前共 {job.cardCount} 张笼卡，距离整页 {job.pageSize} 张还差 {job.missing} 张。是否自动补齐空白卡？
        </p>
      </div>
      <div className="modal-shell-actions">
        <ActionButton icon={<ActionIcon name="print" />} onClick={() => onPrint(false)}>
          直接打印
        </ActionButton>
        <ActionButton icon={<ActionIcon name="print" />} tone="primary" onClick={() => onPrint(true)}>
          补空白卡并打印
        </ActionButton>
      </div>
    </ModalShell>
  );
}
