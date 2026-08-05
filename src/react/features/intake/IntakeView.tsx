import { useQueryClient } from "@tanstack/react-query";
import { Button as MobileButton } from "antd-mobile";
import { useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { IntakeBatch, IntakeListParams, SessionUser } from "../../api/contracts";
import {
  listAllIntakeBatches,
  aiParseIntakeMessage,
  useConfirmIntakeBatch,
  useDeleteIntakeBatch,
  useIntakeBatches,
  useSaveIntakeBatch,
} from "../../api/intake";
import { fetchIacucSearch } from "../../api/iacuc";
import { queryKeys } from "../../api/queryKeys";
import { ActionButton } from "../../components/ui";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { AsyncActionButton, ModalShell, WorkspaceToolbar } from "../../components/WorkspaceUi";
import {
  createIntakeDraft,
  missingIntakeRequiredFields,
  normalizeIntakeBatch,
  parseIntakeMessage,
} from "../../../domain/intake";
import { openIntakeCardPrint } from "../../print/intakeCards";
import { IntakeBatchList, IntakeEntryPanel } from "./components/IntakePanels";
import type { WorkspaceView } from "../../state/ui";

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
  const [deleteTarget, setDeleteTarget] = useState<IntakeBatch | null>(null);
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
  const confirmReceipt = useConfirmIntakeBatch();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;

  function update<K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) {
    setDraft((current) => normalizeIntakeBatch({ ...current, [key]: value }, roomNames));
  }

  async function parseMessage() {
    const parsed = await parseIntakeMessage(draft.rawMessage, user.displayName, roomNames);
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
    for (const item of printable) {
      await save.mutateAsync({
        item: { ...item, status: "printed", updatedAt: new Date().toISOString() },
        exists: true,
      });
    }
    setNotice(`已标记 ${printable.length} 个批次为已打印。`);
  }

  async function printCurrentBatch() {
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
    const popup = window.open("", "_blank");
    if (!popup) {
      setNotice("打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。");
      return;
    }
    popup.document.write(
      '<!doctype html><html lang="zh-CN"><head><title>正在准备笼卡</title></head><body>正在准备笼卡...</body></html>',
    );
    popup.document.close();
    try {
      const response = await save.mutateAsync({ item, exists: editing });
      const saved = normalizeIntakeBatch(response.item, roomNames);
      setDraft(saved);
      setEditing(true);
      if (openIntakeCardPrint([saved], popup)) await markPrinted([saved]);
    } catch (error) {
      popup.close();
      setNotice(error instanceof Error ? error.message : "保存笼卡失败");
    }
  }

  async function receive(targets: IntakeBatch[]) {
    const today = new Date().toISOString().slice(0, 10);
    const printable = targets.filter((item) => item.status === "printed" && item.remainingCardCount > 0);
    for (const item of printable) {
      await confirmReceipt.mutateAsync({ id: item.id, actualReceiptDate: today, cardCount: item.remainingCardCount });
    }
    setNotice(`已确认接收 ${printable.length} 个批次。`);
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
          onPrint={() => void printCurrentBatch()}
          onSubmit={submit}
          onUpdate={update}
          roomNames={roomNames}
          saving={save.isPending}
        />
      </MobilePage>
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
              onPrint={(targets) => {
                if (openIntakeCardPrint(targets)) void markPrinted(targets);
              }}
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
    </section>
  );
}
