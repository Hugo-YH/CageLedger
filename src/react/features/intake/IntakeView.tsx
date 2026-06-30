import { useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { IntakeBatch, IntakeListParams, SessionUser } from "../../api/contracts";
import { useConfirmIntakeBatch, useDeleteIntakeBatch, useIntakeBatches, useSaveIntakeBatch } from "../../api/intake";
import { useIacucIndex } from "../../api/iacuc";
import { ModalShell } from "../../components/WorkspaceUi";
import { createIntakeDraft, normalizeIntakeBatch, parseIntakeMessage } from "../../../domain/intake";
import { openIntakeCardPrint } from "../../print/intakeCards";
import { IntakeBatchList, IntakeEntryPanel } from "./components/IntakePanels";

const pageSize = 10;

export function IntakeView({ user, navigateScanner }: { user: SessionUser; navigateScanner: () => void }) {
  const bootstrap = useBootstrap("summary");
  const iacucQuery = useIacucIndex();
  const roomNames = bootstrap.data?.rooms.map((room) => String(room.name || "")).filter(Boolean) || [];
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "updatedAt", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState(() => createIntakeDraft(user.displayName));
  const [editing, setEditing] = useState(false);
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
    setDraft(
      normalizeIntakeBatch(
        {
          ...draft,
          ...parsed,
          id: editing ? draft.id : parsed.id,
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
    const item = normalizeIntakeBatch({ ...draft, updatedAt: new Date().toISOString() }, roomNames);
    if (!item.supplier || !item.batchNo || !item.quantity || !item.intakeDate) {
      setNotice("请填写购买单位、批次号、动物数量和接收日期。");
      return;
    }
    try {
      const response = await save.mutateAsync({ item, exists: editing });
      setDraft(normalizeIntakeBatch(response.item, roomNames));
      setEditing(true);
      setNotice("待接收批次已保存。");
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    const item = normalizeIntakeBatch({ ...draft, updatedAt: new Date().toISOString() }, roomNames);
    if (!item.supplier || !item.batchNo || !item.quantity || !item.intakeDate) {
      setNotice("打印前请填写购买单位、批次号、动物数量和接收日期。");
      return;
    }
    try {
      const response = await save.mutateAsync({ item, exists: editing });
      const saved = normalizeIntakeBatch(response.item, roomNames);
      setDraft(saved);
      setEditing(true);
      if (openIntakeCardPrint([saved])) await markPrinted([saved]);
    } catch (error) {
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
      <header className="workspace-head">
        <div className="workspace-head-main">
          <span className="workspace-kicker">笼卡接收工作台</span>
          <div className="workspace-title-line">
            <h1>笼卡管理</h1>
            <span className="workspace-status-badge">{total} 个批次</span>
          </div>
          <p>识别预约消息、保存待接收批次，统一打印笼卡并推进到待进驻任务。</p>
          <div className="workspace-meta-strip">
            <div className="workspace-meta-card">
              <span>待接收批次</span>
              <strong>{total}</strong>
            </div>
            <div className="workspace-meta-card success">
              <span>已选批次</span>
              <strong>{selected.length}</strong>
            </div>
          </div>
        </div>
        <div className="workspace-head-actions">
          <button className="primary" type="button" onClick={navigateScanner}>
            笼卡识别
          </button>
        </div>
      </header>
      <div className="workspace-body intake-workspace-body">
        <section className="billing-layout quantity-billing-layout intake-layout">
          <IntakeEntryPanel
            editing={editing}
            draft={draft}
            roomNames={roomNames}
            notice={notice}
            saving={save.isPending}
            onSubmit={submit}
            onNew={startNew}
            onParse={parseMessage}
            onPrint={() => void printCurrentBatch()}
            onUpdate={update}
          />
          <IntakeBatchList
            total={total}
            selected={selected}
            selectedItems={selectedItems}
            items={items}
            loading={list.isFetching}
            page={page}
            totalPages={totalPages}
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
          />
        </section>
      </div>
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
