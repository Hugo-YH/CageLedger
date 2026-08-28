import { useQueryClient } from "@tanstack/react-query";
import { Button as MobileButton } from "antd-mobile";
import { useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { IntakeBatch, IntakeListParams, SessionUser } from "../../api/contracts";
import {
  aiParseIntakeMessage,
  listAllIntakeBatches,
  standardizeIntakeStrain,
  useConfirmIntakeBatchesReceipt,
  useDeleteIntakeBatch,
  useIntakeBatches,
  useMarkIntakeBatchesPrinted,
  useSaveIntakeBatch,
} from "../../api/intake";
import { fetchIacucSearch } from "../../api/iacuc";
import { queryKeys } from "../../api/queryKeys";
import { ActionButton } from "../../components/ui";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { AsyncActionButton, ModalShell, PageSkeleton, WorkspaceToolbar } from "../../components/WorkspaceUi";
import {
  createIntakeDraft,
  missingIntakeRequiredFields,
  normalizeIntakeBatch,
  parseIntakeMessage,
} from "../../../domain/intake";
import {
  openIntakeCardPrint,
  planIntakeCardPrint,
  type IntakeCardPrintKind,
  type IntakePrintRoom,
} from "../../print/intakeCards";
import { IntakeBatchList, IntakeEntryPanel } from "./components/IntakePanels";
import type { WorkspaceView } from "../../state/ui";

interface PendingIntakePrintJob {
  batches: IntakeBatch[];
  kind: IntakeCardPrintKind;
  cardCount: number;
  pageSize: number;
  missing: number;
  saveCurrent: boolean;
  exists: boolean;
}

export function IntakeView({
  user,
  navigate,
  mode,
}: {
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
  mode: "entry" | "batches";
}) {
  const isMobile = useIsMobileLayout();
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
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "updatedAt", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selectedItems, setSelectedItems] = useState<IntakeBatch[]>([]);
  const [selectingAll, setSelectingAll] = useState(false);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
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
  const params: IntakeListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useIntakeBatches(params);
  const save = useSaveIntakeBatch();
  const remove = useDeleteIntakeBatch();
  const markBatchesPrinted = useMarkIntakeBatchesPrinted();
  const confirmBatchesReceipt = useConfirmIntakeBatchesReceipt();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const selectedPrintPlan = planIntakeCardPrint(selectedItems, printRooms);

  if (bootstrap.isPending || (mode === "batches" && list.isPending)) {
    return (
      <PageSkeleton
        label={mode === "entry" ? "笼卡接收" : "待接收批次"}
        variant={mode === "entry" ? "form" : "table"}
      />
    );
  }

  function update<K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) {
    setDraft((current) => normalizeIntakeBatch({ ...current, [key]: value }, roomNames));
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
    const normalized = normalizeIntakeBatch({ ...parsed, rawMessage: draft.rawMessage }, roomNames);
    const normalizedCode = String(parsed.iacuc || "")
      .trim()
      .toUpperCase();
    let match: { project?: string; pi?: string; owner?: string } | undefined;
    if (normalizedCode) {
      const result = await queryClient.ensureQueryData({
        queryKey: queryKeys.iacucSearch(normalizedCode, 1),
        queryFn: () => fetchIacucSearch(normalizedCode, 1),
        staleTime: 5 * 60_000,
      });
      match = result.items[0];
    }
    // Only an explicit edit from the saved-batch list retains the persisted batch ID.
    const isEditingSavedBatch = mode === "batches" && editing;
    setDraft(
      normalizeIntakeBatch(
        {
          ...draft,
          ...normalized,
          id: isEditingSavedBatch ? draft.id : String(normalized.id || draft.id),
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
    try {
      const isEditingSavedBatch = mode === "batches" && editing;
      const response = await save.mutateAsync({ item, exists: isEditingSavedBatch });
      if (isEditingSavedBatch) {
        setDraft(normalizeIntakeBatch(response.item, roomNames));
        setNotice("待接收批次已更新。");
        return;
      }
      setDraft(createIntakeDraft(user.displayName, user.phone));
      setEditing(false);
      setNotice(`待接收批次 ${response.item.batchNo} 已保存，可继续录入下一批。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    }
  }

  function startNew() {
    setDraft(createIntakeDraft(user.displayName, user.phone));
    setEditing(false);
    setNotice("");
  }

  function edit(item: IntakeBatch) {
    setDraft(normalizeIntakeBatch(item, roomNames));
    setEditing(true);
    setEditingDialog(mode === "batches");
  }

  async function markPrinted(targets: IntakeBatch[]) {
    const printable = targets.filter((item) => item.status === "pending_print" || item.status === "draft");
    if (!printable.length) {
      setBulkNotice("选中的批次均未处于待打印状态，无需标记已打印。");
      setBulkNoticeKind("info");
      return;
    }
    setMarkingPrinted(true);
    setBulkNotice(`正在标记 ${printable.length} 个批次为已打印…`);
    setBulkNoticeKind("info");
    try {
      await markBatchesPrinted.mutateAsync(printable.map((item) => item.id));
      const skipped = targets.length - printable.length;
      setBulkNotice(
        skipped
          ? `已标记 ${printable.length} 个批次为已打印；${skipped} 个已打印批次跳过。`
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
    };
    if (job.missing) {
      setPendingPrint(job);
      return;
    }
    void executePrint(job, false);
  }

  async function executePrint(job: PendingIntakePrintJob, fillBlanks: boolean) {
    setPendingPrint(null);
    const popup = window.open("", "_blank");
    if (!popup) {
      const message = "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。";
      if (job.saveCurrent) setNotice(message);
      else {
        setBulkNotice(message);
        setBulkNoticeKind("error");
      }
      return;
    }
    popup.document.write(
      '<!doctype html><html lang="zh-CN"><head><title>正在准备笼卡</title></head><body>正在准备笼卡...</body></html>',
    );
    popup.document.close();
    let printable = job.batches;
    try {
      if (job.saveCurrent) {
        const response = await save.mutateAsync({ item: job.batches[0], exists: job.exists });
        const saved = normalizeIntakeBatch(response.item, roomNames);
        setDraft(saved);
        setEditing(true);
        printable = [saved];
      }
      if (openIntakeCardPrint(printable, { kind: job.kind, fillBlanks, targetWindow: popup })) {
        await markPrinted(printable);
      }
    } catch (error) {
      popup.close();
      const message = error instanceof Error ? error.message : "准备笼卡失败";
      if (job.saveCurrent) setNotice(message);
      else {
        setBulkNotice(message);
        setBulkNoticeKind("error");
      }
    }
  }

  async function receive(targets: IntakeBatch[]) {
    const printable = targets.filter((item) => item.status === "printed");
    if (!printable.length) {
      setBulkNotice("选中的批次均未处于已打印状态，无需标记已接收。");
      setBulkNoticeKind("info");
      return;
    }
    setMarkingReceived(true);
    setBulkNotice(`正在标记 ${printable.length} 个批次为已接收…`);
    setBulkNoticeKind("info");
    try {
      await confirmBatchesReceipt.mutateAsync({ ids: printable.map((item) => item.id) });
      const skipped = targets.length - printable.length;
      setBulkNotice(
        skipped
          ? `已标记 ${printable.length} 个批次为已接收；${skipped} 个未打印批次跳过。`
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

  async function toggleAllFiltered() {
    if (allFilteredSelected) {
      setSelectedItems([]);
      setAllFilteredSelected(false);
      return;
    }
    setSelectingAll(true);
    setAllFilteredSelected(true);
    try {
      setSelectedItems(await listAllIntakeBatches(params));
    } catch (error) {
      setAllFilteredSelected(false);
      setNotice(error instanceof Error ? error.message : "无法读取全部待接收批次");
    } finally {
      setSelectingAll(false);
    }
  }
  if (isMobile && mode === "entry") {
    return (
      <>
        <MobilePage
          actions={
            <>
              <MobileButton size="mini" onClick={startNew}>
                新建批次
              </MobileButton>
              <MobileButton color="primary" form="intake-entry-panel" size="mini" type="submit">
                保存待接收批次
              </MobileButton>
            </>
          }
          onBack={() => navigate("intake-entry")}
          title="接收笼卡"
        >
          <IntakeEntryPanel
            editing={editing}
            draft={draft}
            headActions={null}
            aiPending={aiParsing}
            notice={notice}
            onAiParse={aiParseMessage}
            onParse={parseMessage}
            onPrint={printCurrentBatch}
            onSubmit={submit}
            onUpdate={update}
            roomNames={roomNames}
            saving={save.isPending}
          />
        </MobilePage>
        {pendingPrint ? (
          <IntakePrintConfirmDialog
            job={pendingPrint}
            onClose={() => setPendingPrint(null)}
            onPrint={(fillBlanks) => void executePrint(pendingPrint, fillBlanks)}
          />
        ) : null}
      </>
    );
  }

  return (
    <section className="workspace-view intake-workspace react-intake-view" data-feature="intake">
      <WorkspaceToolbar
        actions={
          mode === "entry" ? (
            <>
              <ActionButton onClick={startNew}>新建批次</ActionButton>
              <AsyncActionButton
                className="primary"
                type="submit"
                form="intake-entry-panel"
                pending={save.isPending}
                pendingLabel="保存中..."
              >
                保存待接收批次
              </AsyncActionButton>
            </>
          ) : null
        }
      />
      <div className="workspace-body intake-workspace-body">
        <section className="billing-layout quantity-billing-layout intake-layout">
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
              bulkNotice={bulkNotice}
              bulkNoticeKind={bulkNoticeKind}
              markingPrinted={markingPrinted}
              markingReceived={markingReceived}
              printDisabledReason={selectedPrintPlan.disabledReason}
              page={page}
              pageSize={pageSize}
              params={params}
              filters={filters}
              onToggleAll={() => void toggleAllFiltered()}
              onToggleItem={(item, checked) => {
                setAllFilteredSelected(false);
                setSelectedItems((current) =>
                  checked
                    ? [...current.filter((selectedItem) => selectedItem.id !== item.id), item]
                    : current.filter((selectedItem) => selectedItem.id !== item.id),
                );
              }}
              onSort={toggleSort}
              onFilter={(key, values) => {
                setFilters((current) => ({ ...current, [key]: values }));
                setSelectedItems([]);
                setAllFilteredSelected(false);
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
      {editingDialog ? (
        <ModalShell ariaLabel="编辑待接收批次" className="intake-edit-modal" onClose={() => setEditingDialog(false)}>
          <div className="modal-shell-head">
            <div>
              <h2>编辑待接收批次</h2>
              <p>{draft.batchNo}</p>
            </div>
            <ActionButton onClick={() => setEditingDialog(false)}>关闭</ActionButton>
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
                <ActionButton loading={save.isPending} tone="primary" type="submit">
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
      {deleteTarget ? (
        <ModalShell ariaLabel="删除待接收批次" onClose={() => setDeleteTarget(null)}>
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
                setSelectedItems((current) => current.filter((item) => item.id !== deleteTarget.id));
                setAllFilteredSelected(false);
                setDeleteTarget(null);
              }}
            >
              确认删除
            </ActionButton>
          </div>
        </ModalShell>
      ) : null}
      {pendingPrint ? (
        <IntakePrintConfirmDialog
          job={pendingPrint}
          onClose={() => setPendingPrint(null)}
          onPrint={(fillBlanks) => void executePrint(pendingPrint, fillBlanks)}
        />
      ) : null}
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
        <ActionButton onClick={() => onPrint(false)}>直接打印</ActionButton>
        <ActionButton tone="primary" onClick={() => onPrint(true)}>
          补空白卡并打印
        </ActionButton>
      </div>
    </ModalShell>
  );
}
