import { useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { IntakeBatch, IntakeListParams, SessionUser } from "../../api/contracts";
import { useConfirmIntakeBatch, useDeleteIntakeBatch, useIntakeBatches, useSaveIntakeBatch } from "../../api/intake";
import { useIacucIndex } from "../../api/iacuc";
import { ModalShell, WorkspaceHeader } from "../../components/WorkspaceUi";
import {
  createIntakeDraft,
  missingIntakeRequiredFields,
  normalizeIntakeBatch,
  parseIntakeMessage,
} from "../../../domain/intake";
import { openIntakeCardPrint } from "../../print/intakeCards";
import { IntakeBatchList, IntakeEntryPanel } from "./components/IntakePanels";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, intakeSwitchItems } from "../shell/workspaceNavigation";

export function IntakeView({
  user,
  navigate,
  mode,
}: {
  user: SessionUser;
  navigate: (view: WorkspaceView) => void;
  mode: "entry" | "batches";
}) {
  const bootstrap = useBootstrap("summary");
  const iacucQuery = useIacucIndex();
  const roomNames = bootstrap.data?.rooms.map((room) => String(room.name || "")).filter(Boolean) || [];
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "updatedAt", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState(() => createIntakeDraft(user.displayName));
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
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const selectedItems = items.filter((item) => selected.includes(item.id));

  function update<K extends keyof IntakeBatch>(key: K, value: IntakeBatch[K]) {
    setDraft((current) => normalizeIntakeBatch({ ...current, [key]: value }, roomNames));
  }

  function parseMessage() {
    const parsed = parseIntakeMessage(draft.rawMessage, user.displayName, roomNames);
    const match = iacucQuery.data?.items.find(
      (item) => item.iacuc.trim().toUpperCase() === parsed.iacuc.trim().toUpperCase(),
    );
    // Only an explicit edit from the saved-batch list retains the persisted batch ID.
    const isEditingSavedBatch = mode === "batches" && editing;
    setDraft(
      normalizeIntakeBatch(
        {
          ...draft,
          ...parsed,
          id: isEditingSavedBatch ? draft.id : parsed.id,
          project: match?.project || parsed.project,
          pi: match?.pi || parsed.pi,
          owner: match?.owner || parsed.owner,
        },
        roomNames,
      ),
    );
    setNotice(parsed.batchNo ? "预约消息已识别，请核对批次信息。" : "未识别到完整批次号，请手动补充。");
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
      setDraft(createIntakeDraft(user.displayName));
      setEditing(false);
      setNotice(`待接收批次 ${response.item.batchNo} 已保存，可继续录入下一批。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    }
  }

  function startNew() {
    setDraft(createIntakeDraft(user.displayName));
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

  function togglePage(checked: boolean) {
    setSelected(checked ? items.map((item) => item.id) : []);
  }

  return (
    <section className="workspace-view intake-workspace react-intake-view">
      <WorkspaceHeader
        kicker="笼卡接收工作台"
        title={mode === "entry" ? "预约消息识别" : "待接收批次"}
        breadcrumbs={[breadcrumb("笼卡管理", () => navigate("intake-entry"))]}
        summary={
          mode === "entry"
            ? "识别预约消息或扫描笼卡，核对信息后保存为待接收批次。"
            : "集中查询、打印和接收已保存批次，接收后自动进入待进驻任务。"
        }
        status={mode === "entry" ? "预约信息录入" : `${total} 个批次`}
        metrics={[
          { label: "待接收批次", value: total },
          { label: "已选批次", value: selected.length, tone: "success" },
        ]}
        actions={
          mode === "entry" ? (
            <button className="primary" type="button" onClick={() => navigate("cage-card-scanner")}>
              二维码扫描
            </button>
          ) : null
        }
        switcherLabel="笼卡功能"
        switcherItems={intakeSwitchItems(navigate)}
        toolbar={
          mode === "entry" ? (
            <>
              <button className="secondary" type="button" onClick={startNew}>
                新建批次
              </button>
              <button className="primary" type="submit" form="intake-entry-panel" disabled={save.isPending}>
                {save.isPending ? "保存中..." : "保存待接收批次"}
              </button>
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
              onSubmit={submit}
              headActions={null}
              onParse={parseMessage}
              onPrint={() => void printCurrentBatch()}
              onUpdate={update}
            />
          ) : (
            <IntakeBatchList
              total={total}
              selected={selected}
              selectedItems={selectedItems}
              items={items}
              loading={list.isFetching}
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              params={params}
              filters={filters}
              onTogglePage={togglePage}
              onToggleItem={(id, checked) =>
                setSelected((current) =>
                  checked ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id),
                )
              }
              onSort={toggleSort}
              onFilter={(key, values) => {
                setFilters((current) => ({ ...current, [key]: values }));
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
                setSelected([]);
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
            <button className="secondary" type="button" onClick={() => setEditingDialog(false)}>
              关闭
            </button>
          </div>
          <div className="modal-shell-body">
            <IntakeEntryPanel
              editing={editing}
              draft={draft}
              roomNames={roomNames}
              notice={notice}
              saving={save.isPending}
              onSubmit={submit}
              headActions={
                <button className="primary" type="submit" disabled={save.isPending}>
                  {save.isPending ? "保存中..." : "保存待接收批次"}
                </button>
              }
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
            <button className="secondary" type="button" onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button
              className="danger"
              type="button"
              disabled={remove.isPending}
              onClick={async () => {
                await remove.mutateAsync(deleteTarget.id);
                setSelected((current) => current.filter((id) => id !== deleteTarget.id));
                setDeleteTarget(null);
              }}
            >
              确认删除
            </button>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}
