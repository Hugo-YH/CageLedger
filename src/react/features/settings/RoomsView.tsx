import { useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRack, CageRoom, CageSlot, SessionUser } from "../../api/contracts";
import { useDeleteRoom, useSaveInfrastructure } from "../../api/administration";
import { ConfirmDialog, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";

type RoomDraft = CageRoom & { billingProfileConfigured?: boolean; billingProfileConfirmed?: boolean; rackCount?: number };
const facilityOptions = [["zhujiang", "珠江新城设施"], ["bioisland", "生物岛设施"]];
const speciesOptions = [["mouse", "小鼠"], ["rat", "大鼠"], ["guinea_pig", "豚鼠"], ["rabbit", "兔"], ["monkey", "猴"], ["dog", "犬"], ["pig", "猪"]];
const billingOptions = [["mouse_standard", "小鼠饲养费"], ["mouse_diabetic", "糖尿病小鼠饲养费"], ["rat_standard", "大鼠饲养费"], ["rat_diabetic", "糖尿病大鼠饲养费"], ["guinea_pig", "豚鼠饲养费"], ["rabbit", "兔饲养费"], ["monkey", "猴饲养费"], ["pig", "猪饲养费"], ["dog", "犬饲养费"]];

export function RoomsView({ user }: { user: SessionUser }) {
  const query = useBootstrap("full");
  const save = useSaveInfrastructure();
  const removeRoom = useDeleteRoom();
  const [roomDraft, setRoomDraft] = useState<RoomDraft | null>(null);
  const [rackDraft, setRackDraft] = useState<CageRack | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "room" | "rack"; id: string; label: string } | null>(null);
  const canManageRooms = user.role === "admin";
  if (query.isPending) return <section className="workspace-view"><PageState title="正在加载基础设施..."/></section>;
  if (query.isError || !query.data) return <section className="workspace-view"><PageState title="基础设施加载失败" retry={() => query.refetch()}/></section>;
  const { rooms, racks, slots } = query.data;
  const visibleRooms = rooms as unknown as CageRoom[];
  const cageRacks = racks as unknown as CageRack[];
  const cageSlots = slots as unknown as CageSlot[];
  async function persistRoom() {
    if (!roomDraft?.name.trim()) return;
    const exists = visibleRooms.some((room) => room.id === roomDraft.id);
    await save.mutateAsync(exists ? { roomUpdates: [roomDraft] } : { rooms: [roomDraft] });
    setRoomDraft(null);
  }
  async function persistRack() {
    if (!rackDraft?.roomId || rackDraft.rows < 1 || rackDraft.cols < 1) return;
    const existing = cageRacks.find((rack) => rack.id === rackDraft.id);
    const room = visibleRooms.find((item) => item.id === rackDraft.roomId);
    if (!room) return;
    const nextSlots = generateSlots(rackDraft);
    const existingSlots = cageSlots.filter((slot) => slot.rackId === rackDraft.id);
    const positions = new Set(nextSlots.map(slotKey));
    const oldPositions = new Set(existingSlots.map(slotKey));
    const slotCreates = nextSlots.filter((slot) => !oldPositions.has(slotKey(slot)));
    const slotDeletes = existingSlots.filter((slot) => !positions.has(slotKey(slot))).map((slot) => slot.id);
    const roomRacks = cageRacks.filter((rack) => rack.roomId === room.id);
    await save.mutateAsync(existing ? { rackUpdates: [rackDraft], slots: slotCreates, slotDeletes } : { racks: [rackDraft], slots: nextSlots, roomUpdates: [{ ...room, rackCount: roomRacks.length + 1 } as CageRoom] });
    setRackDraft(null);
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "room") await removeRoom.mutateAsync(deleteTarget.id);
    else {
      const rack = cageRacks.find((item) => item.id === deleteTarget.id);
      const room = visibleRooms.find((item) => item.id === rack?.roomId);
      const count = cageRacks.filter((item) => item.roomId === room?.id).length;
      await save.mutateAsync({ rackDeletes: [deleteTarget.id], roomUpdates: room ? [{ ...room, rackCount: Math.max(count - 1, 0) } as CageRoom] : [] });
    }
    setDeleteTarget(null);
  }
  return <section className="workspace-view settings-workspace"><WorkspaceHeader kicker="基础设施工作台" title="房间管理" summary="维护饲养间、笼架和笼位规模，供笼位录入与饲养费核算共同使用。" status={canManageRooms ? "系统管理员可维护" : "当前账号可维护授权笼架"} actions={<div className="workspace-head-button-row">{canManageRooms ? <button className="secondary" type="button" onClick={() => setRoomDraft(newRoomDraft())}>新增饲养间</button> : null}<button className="primary" type="button" disabled={!visibleRooms.length} onClick={() => setRackDraft(newRackDraft(visibleRooms[0], cageRacks))}>新增笼架</button></div>}/><div className="workspace-body settings-workspace-body"><section className="panel large"><div className="panel-head"><div className="panel-title-line"><h2>饲养间与笼架</h2></div><div className="panel-head-actions"><span className="panel-summary-chip">{visibleRooms.length} 间 · {cageRacks.length} 架 · {cageSlots.length} 笼位</span></div></div><div className="room-list react-room-list">{visibleRooms.map((room) => { const roomRacks = cageRacks.filter((rack) => rack.roomId === room.id); return <article className="room-card" key={room.id}><div className="room-card-head"><div><strong>{room.name}</strong><span>{room.area || "未设置区域"} · {facilityLabel(room.facility)}</span></div><div className="table-actions">{canManageRooms ? <button className="ghost" type="button" onClick={() => setRoomDraft({ ...room })}>编辑房间</button> : null}{canManageRooms && visibleRooms.length > 1 ? <button className="ghost danger-text" type="button" onClick={() => setDeleteTarget({ kind: "room", id: room.id, label: room.name })}>删除</button> : null}</div></div><div className="rack-tree">{roomRacks.length ? roomRacks.map((rack) => <div className="rack-tree-item" key={rack.id}><div><strong>笼架 {rack.index}</strong><span>{rack.rows} 行 × {rack.cols} 列 · {cageSlots.filter((slot) => slot.rackId === rack.id).length} 笼位</span></div><div className="table-actions"><button className="ghost" type="button" onClick={() => setRackDraft({ ...rack })}>编辑</button><button className="ghost danger-text" type="button" onClick={() => setDeleteTarget({ kind: "rack", id: rack.id, label: `${room.name} 笼架 ${rack.index}` })}>删除</button></div></div>) : <div className="empty-state compact"><p>当前房间尚未创建笼架。</p></div>}</div><button className="secondary room-add-rack" type="button" onClick={() => setRackDraft(newRackDraft(room, cageRacks))}>在此房间新增笼架</button></article>; })}</div></section></div>{roomDraft ? <RoomEditor draft={roomDraft} pending={save.isPending} onChange={setRoomDraft} onClose={() => setRoomDraft(null)} onSave={() => void persistRoom()}/> : null}{rackDraft ? <RackEditor draft={rackDraft} rooms={visibleRooms} pending={save.isPending} onChange={setRackDraft} onClose={() => setRackDraft(null)} onSave={() => void persistRack()}/> : null}{deleteTarget ? <ConfirmDialog title={`删除${deleteTarget.kind === "room" ? "饲养间" : "笼架"}`} message={`确认删除“${deleteTarget.label}”？关联笼位将同步移除，占用历史继续保留。`} confirmLabel="确认删除" danger pending={save.isPending || removeRoom.isPending} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()}/> : null}</section>;
}

function RoomEditor({ draft, pending, onChange, onClose, onSave }: { draft: RoomDraft; pending: boolean; onChange: (draft: RoomDraft) => void; onClose: () => void; onSave: () => void }) { const update = (key: keyof RoomDraft, value: string | number) => onChange({ ...draft, [key]: value }); return <div className="modal-backdrop"><section className="modal-shell settings-editor-modal" role="dialog" aria-modal="true"><div className="modal-shell-head"><h2>{draft.name ? "编辑饲养间" : "新增饲养间"}</h2><button className="secondary" type="button" onClick={onClose}>关闭</button></div><div className="modal-shell-body form"><Field label="饲养间名称" value={draft.name} onChange={(value) => update("name", value)}/><Field label="区域" value={draft.area || ""} onChange={(value) => update("area", value)}/><div className="compact-form-row half"><Select label="所属设施" value={draft.facility || "zhujiang"} options={facilityOptions} onChange={(value) => update("facility", value)}/><Select label="默认动物" value={draft.defaultSpecies || "mouse"} options={speciesOptions} onChange={(value) => update("defaultSpecies", value)}/></div><Select label="默认收费项目" value={draft.defaultBillingItem || "mouse_standard"} options={billingOptions} onChange={(value) => update("defaultBillingItem", value)}/><div className="compact-form-row half"><Select label="默认院内/院外" value={draft.defaultCustomerType || "internal"} options={[["internal", "院内"], ["external", "院外"]]} onChange={(value) => update("defaultCustomerType", value)}/><Field label="默认每笼只数" type="number" value={String(draft.defaultAnimalCount || 1)} onChange={(value) => update("defaultAnimalCount", Math.max(Number(value), 1))}/></div></div><div className="modal-shell-actions"><button className="secondary" type="button" onClick={onClose}>取消</button><button className="primary" type="button" disabled={pending || !draft.name.trim()} onClick={onSave}>保存饲养间</button></div></section></div>; }
function RackEditor({ draft, rooms, pending, onChange, onClose, onSave }: { draft: CageRack; rooms: CageRoom[]; pending: boolean; onChange: (draft: CageRack) => void; onClose: () => void; onSave: () => void }) { const update = (key: keyof CageRack, value: string | number) => onChange({ ...draft, [key]: value }); return <div className="modal-backdrop"><section className="modal-shell settings-editor-modal" role="dialog" aria-modal="true"><div className="modal-shell-head"><h2>编辑笼架</h2><button className="secondary" type="button" onClick={onClose}>关闭</button></div><div className="modal-shell-body form"><label>所属饲养间<select value={draft.roomId} onChange={(event) => update("roomId", event.target.value)}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><div className="compact-form-row third"><Field label="笼架编号" type="number" value={String(draft.index)} onChange={(value) => update("index", Math.max(Number(value), 1))}/><Field label="行数" type="number" value={String(draft.rows)} onChange={(value) => update("rows", Math.max(Number(value), 1))}/><Field label="列数" type="number" value={String(draft.cols)} onChange={(value) => update("cols", Math.max(Number(value), 1))}/></div></div><div className="modal-shell-actions"><button className="secondary" type="button" onClick={onClose}>取消</button><button className="primary" type="button" disabled={pending} onClick={onSave}>保存笼架</button></div></section></div>; }
function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label>{label}<input type={type} min={type === "number" ? 1 : undefined} value={value} onChange={(event) => onChange(event.target.value)}/></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>; }
function newRoomDraft(): RoomDraft { return { id: `room-${crypto.randomUUID()}`, name: "", area: "", facility: "zhujiang", defaultSpecies: "mouse", defaultBillingItem: "mouse_standard", defaultCustomerType: "internal", defaultAnimalCount: 1, billingProfileConfigured: false, billingProfileConfirmed: false, rackCount: 0 }; }
function newRackDraft(room: CageRoom, racks: CageRack[]): CageRack { const indexes = racks.filter((rack) => rack.roomId === room.id).map((rack) => rack.index); return { id: `rack-${crypto.randomUUID()}`, roomId: room.id, name: "", index: indexes.length ? Math.max(...indexes) + 1 : 1, rows: 6, cols: 10 }; }
function generateSlots(rack: CageRack): CageSlot[] { const slots: CageSlot[] = []; for (let row = 1; row <= rack.rows; row += 1) for (let col = 1; col <= rack.cols; col += 1) slots.push({ id: `slot-${rack.id}-${row}-${col}`, rackId: rack.id, row, col, status: "empty" }); return slots; }
function slotKey(slot: CageSlot) { return `${slot.row}:${slot.col}`; }
function facilityLabel(value?: string) { return value === "bioisland" ? "生物岛设施" : "珠江新城设施"; }
