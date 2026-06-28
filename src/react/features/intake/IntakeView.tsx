import { useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { IntakeBatch, IntakeBatchStatus, IntakeListParams, SessionUser } from "../../api/contracts";
import { useConfirmIntakeBatch, useDeleteIntakeBatch, useIntakeBatches, useIntakeFilterOptions, useSaveIntakeBatch } from "../../api/intake";
import { useIacucIndex } from "../../api/iacuc";
import { FilterableTableHeader } from "../../components/FilterableTableHeader";
import { createIntakeDraft, intakeStatusLabel, normalizeIntakeBatch, parseIntakeMessage } from "../../../domain/intake";
import { openIntakeCardPrint } from "../../print/intakeCards";

const pageSize = 10;
const statuses: Array<[IntakeBatchStatus, string]> = [["pending_print", "未打印"], ["printed", "已打印"], ["received", "已接收"], ["draft", "草稿"]];

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
  const params: IntakeListParams = { limit: pageSize, offset: (page - 1) * pageSize, sortKey: sort.key, sortDir: sort.dir, columnFilters: filters };
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
    const match = iacucQuery.data?.items.find((item) => item.iacuc.trim().toUpperCase() === parsed.iacuc.trim().toUpperCase());
    setDraft(normalizeIntakeBatch({ ...draft, ...parsed, id: editing ? draft.id : parsed.id, project: match?.project || parsed.project, pi: match?.pi || parsed.pi, owner: match?.owner || parsed.owner }, roomNames));
    setNotice(parsed.batchNo ? "预约消息已识别，请核对批次信息。" : "未识别到完整批次号，请手动补充。" );
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
      await save.mutateAsync({ item: { ...item, status: "printed", updatedAt: new Date().toISOString() }, exists: true });
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
        <div className="workspace-head-main"><span className="workspace-kicker">笼卡接收工作台</span><div className="workspace-title-line"><h1>笼卡管理</h1><span className="workspace-status-badge">{total} 个批次</span></div><p>识别预约消息、保存待接收批次，统一打印笼卡并推进到待进驻任务。</p><div className="workspace-meta-strip"><div className="workspace-meta-card"><span>待接收批次</span><strong>{total}</strong></div><div className="workspace-meta-card success"><span>已选批次</span><strong>{selected.length}</strong></div></div></div>
        <div className="workspace-head-actions"><button className="primary" type="button" onClick={navigateScanner}>笼卡识别</button></div>
      </header>
      <div className="workspace-body intake-workspace-body">
        <section className="billing-layout quantity-billing-layout intake-layout">
          <form className="panel large intake-entry-panel" onSubmit={submit}>
            <div className="panel-head"><div className="panel-title-line"><h2>{editing ? "编辑接收笼卡" : "接收笼卡"}</h2></div><div className="panel-head-actions"><button className="secondary" type="button" onClick={startNew}>新建批次</button><button className="primary" type="submit" disabled={save.isPending}>{save.isPending ? "保存中..." : "保存待接收批次"}</button></div></div>
            <div className="intake-entry-layout">
              <div className="intake-message-field"><div className="intake-message-head"><span>预约消息识别</span><button className="secondary compact-action" type="button" onClick={parseMessage}>识别文本</button></div><textarea aria-label="预约消息" rows={6} value={draft.rawMessage} onChange={(event) => update("rawMessage", event.target.value)} placeholder="粘贴预约接收文本，自动提取批次号、供应商、品系、数量、房间和接收日期。" /></div>
              <div className="intake-action-panel"><strong>{draft.finalCardCount || 0} 张笼卡</strong><span>{draft.batchNo || "尚未识别批次"}</span><button className="secondary info-button" type="button" disabled={!draft.finalCardCount || save.isPending} onClick={() => void printCurrentBatch()}>打印当前笼卡</button></div>
            </div>
            {notice ? <div className="react-inline-notice" role="status">{notice}</div> : null}
            <div className="intake-form-grid">
              <div className="intake-field-row three">
                <Field label="购买单位" required value={draft.supplier} onChange={(value) => update("supplier", value)} />
                <Field label="批次号" required value={draft.batchNo} onChange={(value) => update("batchNo", value)} />
                <Field label="IACUC 编号" value={draft.iacuc} onChange={(value) => update("iacuc", value)} />
              </div>
              <div className="intake-field-row two"><Field label="项目负责人" value={draft.pi} onChange={(value) => update("pi", value)} /><Field label="实验负责人/助手" value={draft.owner} onChange={(value) => update("owner", value)} /></div>
              <div className="intake-field-row four">
                <label>物种<select value={draft.species} onChange={(event) => update("species", event.target.value)}><option value="mouse">小鼠</option><option value="rat">大鼠</option><option value="guinea_pig">豚鼠</option><option value="rabbit">兔</option><option value="monkey">猴</option><option value="pig">猪</option><option value="dog">犬</option></select></label>
                <Field label="品系" value={draft.strainStandard} onChange={(value) => update("strainStandard", value)} />
                <Field label="数量（只）" required type="number" value={draft.quantity ?? ""} onChange={(value) => update("quantity", value ? Number(value) : null)} />
                <label>房间<select value={draft.roomName} onChange={(event) => update("roomName", event.target.value)}><option value="">请选择系统房间</option>{roomNames.map((room) => <option key={room} value={room}>{room}</option>)}</select></label>
              </div>
              <div className="intake-field-row three"><Field label="接收日期" required type="date" value={draft.intakeDate} onChange={(value) => update("intakeDate", value)} /><Field label="饲养周期（天）" type="number" value={draft.husbandryDays ?? ""} onChange={(value) => update("husbandryDays", value ? Number(value) : null)} /><Field label="结束日期" type="date" value={draft.endDate} onChange={(value) => update("endDate", value)} /></div>
              <div className="intake-field-row three"><Field label="性别" value={draft.sex} onChange={(value) => update("sex", value)} /><Field label="接收人员" value={draft.receiverName} onChange={(value) => update("receiverName", value)} /><Field label="兽医电话" value={draft.vetPhone} onChange={(value) => update("vetPhone", value)} /></div>
              <div className="intake-field-row two"><Field label="打印张数" type="number" value={draft.finalCardCount} onChange={(value) => update("finalCardCount", Number(value) || 0)} /><label>状态<select value={draft.status} onChange={(event) => update("status", event.target.value as IntakeBatchStatus)}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
            </div>
          </form>

          <section className="panel intake-batch-list-panel">
            <div className="panel-head"><div className="panel-title-line"><h2>待接收批次列表</h2></div><div className="panel-head-actions"><span className="panel-summary-chip">{total} 条 · 已选 {selected.length}</span></div></div>
            {selectedItems.length ? <div className="bulk-action-bar"><strong>已选 {selectedItems.length} 项</strong><div><button className="primary" type="button" onClick={() => { if (openIntakeCardPrint(selectedItems)) void markPrinted(selectedItems); }}>打印笼卡</button><button className="secondary" type="button" onClick={() => void markPrinted(selectedItems)}>标记已打印</button><button className="secondary" type="button" onClick={() => void receive(selectedItems)}>确认接收</button></div></div> : null}
            <div className="list-meta"><span>{list.isFetching ? "正在加载" : `当前加载 ${items.length} 条`}</span><span>第 {page} / {totalPages} 页</span></div>
            <div className="table-wrap">
              <table className="workflow-table intake-batch-table dense-table">
                <thead><tr><th><input type="checkbox" aria-label="全选当前页" checked={items.length > 0 && selectedItems.length === items.length} onChange={(event) => togglePage(event.target.checked)} /></th>{[["status", "状态"], ["batchNo", "批次号"], ["supplier", "购买单位"], ["pi", "项目负责人"], ["owner", "实验负责人"], ["quantity", "数量"], ["roomName", "房间"], ["intakeDate", "接收日期"], ["cardCount", "笼卡"]].map(([key, label]) => <IntakeHeader key={key} column={key} label={label} params={params} values={filters[key] || []} onSort={() => toggleSort(key)} onFilter={(values) => { setFilters((current) => ({ ...current, [key]: values })); setPage(1); }} />)}<th>操作</th></tr></thead>
                <tbody>{items.length ? items.map((item) => <tr key={item.id}><td><input type="checkbox" aria-label={`选择 ${item.batchNo}`} checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} /></td><td><span className={`pill ${item.status}`}>{intakeStatusLabel(item.status)}</span></td><td>{item.batchNo}</td><td>{item.supplier}</td><td>{item.pi || "-"}</td><td>{item.owner || "-"}</td><td>{item.quantity ?? "-"}</td><td>{item.roomName || "-"}</td><td>{item.intakeDate || "-"}</td><td>{item.finalCardCount}</td><td><div className="table-actions"><button className="ghost info-button compact" type="button" onClick={() => edit(item)}>编辑</button><button className="ghost danger-text compact" type="button" onClick={() => setDeleteTarget(item)}>删除</button></div></td></tr>) : <tr><td colSpan={11}><div className="empty-state"><h3>暂无待接收批次</h3><p>在上方识别预约消息并保存后，批次会显示在这里。</p></div></td></tr>}</tbody>
              </table>
            </div>
            <div className="pager"><span>共 {total} 条</span><div><button className="secondary" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="secondary" type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></div></div>
          </section>
        </section>
      </div>
      {deleteTarget ? <div className="modal-backdrop" role="presentation"><section className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="delete-intake-title"><div className="modal-shell-head"><div><h2 id="delete-intake-title">删除待接收批次</h2><p>{deleteTarget.batchNo}</p></div></div><div className="modal-shell-body"><p>删除后，该批次及关联的待进驻任务会一并移除。</p></div><div className="modal-shell-actions"><button className="secondary" type="button" onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" type="button" disabled={remove.isPending} onClick={async () => { await remove.mutateAsync(deleteTarget.id); setSelected((current) => current.filter((id) => id !== deleteTarget.id)); setDeleteTarget(null); }}>确认删除</button></div></section></div> : null}
    </section>
  );
}

function IntakeHeader({ column, label, params, values, onSort, onFilter }: { column: string; label: string; params: IntakeListParams; values: string[]; onSort: () => void; onFilter: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const options = useIntakeFilterOptions(params, column, open);
  return <FilterableTableHeader label={label} values={values} options={options.data?.items || []} loading={options.isFetching} onOpenChange={setOpen} onSort={onSort} onFilter={onFilter} />;
}

function Field({ label, value, onChange, type = "text", required = false }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className={required ? "field-required" : undefined}>{label}<input type={type} value={value} min={type === "number" ? 0 : undefined} required={required} onChange={(event) => onChange(event.target.value)} /></label>;
}
