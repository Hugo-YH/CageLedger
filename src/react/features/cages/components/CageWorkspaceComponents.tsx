import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { CageRack, CageSlot, CageSlotStatus, Occupancy, PlacementTask } from "../../../api/contracts";
import { useMoveInPlacement, useReservePlacement, useSaveOccupancy } from "../../../api/cages";
import { ModalShell } from "../../../components/WorkspaceUi";
import { animalAgeText, cageCode, currentOccupancy, emptyOccupancy, slotPosition } from "../../../../domain/cages";
import { CageSlotButton } from "./CageSlotButton";

const today = new Date().toISOString().slice(0, 10);

export function VirtualRack({
  rack,
  roomName,
  roomSpecies,
  slots,
  occupancies,
  selectedSlotId,
  selectedSlotIds,
  onSelect,
}: {
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  slots: CageSlot[];
  occupancies: Occupancy[];
  selectedSlotId: string;
  selectedSlotIds: string[];
  onSelect: (slot: CageSlot) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = Array.from(new Set(slots.map((slot) => slot.row))).sort((a, b) => a - b);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (roomSpecies === "monkey" ? 144 : 126),
    overscan: 3,
  });
  return (
    <div className="react-rack-scroll" ref={scrollRef}>
      <div className="react-rack-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              className={`react-rack-row ${roomSpecies === "monkey" ? "monkey-rack-row" : ""}`}
              key={row}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${rack.cols}, minmax(112px, 1fr))`,
              }}
            >
              {slots
                .filter((slot) => slot.row === row)
                .sort((a, b) => a.col - b.col)
                .map((slot) => (
                  <CageSlotButton
                    key={slot.id}
                    slot={slot}
                    rack={rack}
                    roomName={roomName}
                    roomSpecies={roomSpecies}
                    occupancy={currentOccupancy(slot.id, occupancies)}
                    selected={slot.id === selectedSlotId || selectedSlotIds.includes(slot.id)}
                    today={today}
                    onClick={() => onSelect(slot)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SlotEditor({
  slot,
  rack,
  roomName,
  roomSpecies,
  occupancy,
  roomId,
  onClose,
  onNotice,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  occupancy: Occupancy | null;
  roomId: string;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(
    () => occupancy || emptyOccupancy(slot.id, cageCode(slot, rack.index, roomName), today),
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const showMonkeyFields = roomSpecies === "monkey";
  const ageText = animalAgeText(draft.birthDate, today);
  const save = useSaveOccupancy(roomId);
  const update = (key: keyof Occupancy, value: string | number | null) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await save.mutateAsync({ item: { ...draft, slotId: slot.id, updatedAt: today }, exists: Boolean(occupancy) });
      onNotice(`笼位 ${cageCode(slot, rack.index, roomName)} 已保存。`);
      onClose();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "保存失败");
    }
  }
  async function clear() {
    if (!occupancy) {
      onClose();
      return;
    }
    await save.mutateAsync({
      item: { ...occupancy, status: "ended", endDate: today, updatedAt: today },
      exists: true,
    });
    onNotice(`笼位 ${cageCode(slot, rack.index, roomName)} 已设为空。`);
    onClose();
  }
  return (
    <ModalShell
      ariaLabel={`编辑笼位 ${cageCode(slot, rack.index, roomName)}`}
      className="cage-slot-modal"
      onClose={onClose}
    >
      <div className="modal-shell-head">
        <div>
          <h2 id="slot-editor-title">编辑笼位 {cageCode(slot, rack.index, roomName)}</h2>
          <p>{occupancy ? "维护当前占用记录" : "录入新的占用记录"}</p>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <form className="modal-shell-body form compact-slot-form" onSubmit={submit}>
        <div className="compact-form-row third">
          <label>
            状态
            <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
              <option value="active">在用</option>
              <option value="reserved">已预约</option>
            </select>
          </label>
          <Field label="笼盒编号" value={draft.cageCode} onChange={(value) => update("cageCode", value)} />
          <Field
            label="动物数量"
            type="number"
            value={draft.animalCount || ""}
            onChange={(value) => update("animalCount", value ? Number(value) : null)}
          />
        </div>
        {showMonkeyFields ? (
          <fieldset className="monkey-detail-fields">
            <legend>猴个体信息</legend>
            <div className="compact-form-row third">
              <label>
                性别
                <select
                  value={draft.animalSex || "unknown"}
                  onChange={(event) => update("animalSex", event.target.value)}
                >
                  <option value="unknown">请选择</option>
                  <option value="male">雄</option>
                  <option value="female">雌</option>
                </select>
              </label>
              <Field
                label="出生日期"
                type="date"
                value={draft.birthDate || ""}
                max={today}
                onChange={(value) => update("birthDate", value)}
              />
              <div className="monkey-age-field">
                <label htmlFor="monkey-age">年龄</label>
                <input
                  id="monkey-age"
                  type="text"
                  value={ageText || "自动计算"}
                  readOnly
                  aria-describedby="monkey-age-help"
                />
                <small id="monkey-age-help">根据出生日期自动计算</small>
              </div>
            </div>
          </fieldset>
        ) : null}
        <div className="compact-form-row half">
          <Field label="IACUC 编号" value={draft.iacuc} onChange={(value) => update("iacuc", value)} />
          <Field label="项目名称" value={draft.project} onChange={(value) => update("project", value)} />
        </div>
        <div className="compact-form-row half">
          <Field label="项目负责人" value={draft.pi} onChange={(value) => update("pi", value)} />
          <Field label="实验负责人" value={draft.owner} onChange={(value) => update("owner", value)} />
        </div>
        <div className="compact-form-row third">
          <Field
            label="开始日期"
            type="date"
            value={draft.startDate}
            onChange={(value) => update("startDate", value)}
          />
          <Field
            label="饲养周期（天）"
            type="number"
            value={draft.feedingDays || ""}
            onChange={(value) => update("feedingDays", value ? Number(value) : null)}
          />
          <Field label="结束日期" type="date" value={draft.endDate} onChange={(value) => update("endDate", value)} />
        </div>
        <label>
          备注
          <textarea rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)} />
        </label>
        <div className="modal-shell-actions">
          <button
            className="ghost danger-text"
            type="button"
            onClick={() => (confirmClear ? void clear() : setConfirmClear(true))}
          >
            {confirmClear ? "再次点击确认设为空" : "设为空"}
          </button>
          <button className="primary" type="submit" disabled={save.isPending}>
            保存笼位
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function PlacementDrawer({
  tasks,
  selectedTaskId,
  roomId,
  onSelect,
  onClose,
}: {
  tasks: PlacementTask[];
  selectedTaskId: string;
  roomId: string;
  onSelect: (task: PlacementTask) => void;
  onClose: () => void;
}) {
  const moveIn = useMoveInPlacement(roomId);
  return (
    <ModalShell ariaLabel="待进驻动物" className="placement-react-drawer" onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2>待进驻动物</h2>
          <p>{tasks.length} 个待处理笼位</p>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="modal-shell-body placement-react-list">
        {tasks.length ? (
          tasks.map((task) => (
            <article key={task.id} className={selectedTaskId === task.id ? "selected" : ""}>
              <div>
                <span className={`pill ${task.status}`}>{task.status === "pending" ? "待分配" : "已预留"}</span>
                <strong>{task.batchNo || "未命名批次"}</strong>
                <small>
                  {task.plannedMoveInDate || "-"} · {task.pi || "-"} · {task.owner || "-"}
                </small>
              </div>
              {task.status === "pending" ? (
                <button className="primary" type="button" onClick={() => onSelect(task)}>
                  选择空笼位
                </button>
              ) : (
                <button
                  className="primary"
                  type="button"
                  disabled={moveIn.isPending}
                  onClick={() => void moveIn.mutateAsync({ taskId: task.id, actualMoveInDate: today })}
                >
                  正式入驻
                </button>
              )}
            </article>
          ))
        ) : (
          <div className="empty-state">
            <h3>当前房间没有待进驻任务</h3>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

export function BatchSlotEditor({
  slots,
  rack,
  roomName,
  occupancies,
  roomId,
  onClose,
  onDone,
}: {
  slots: CageSlot[];
  rack: CageRack;
  roomName: string;
  occupancies: Occupancy[];
  roomId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const first = slots.map((slot) => currentOccupancy(slot.id, occupancies)).find(Boolean);
  const [draft, setDraft] = useState({
    status: (first?.status === "reserved" ? "reserved" : "active") as CageSlotStatus,
    iacuc: first?.iacuc || "",
    project: first?.project || "",
    pi: first?.pi || "",
    owner: first?.owner || "",
    startDate: first?.startDate || today,
    endDate: first?.endDate || "",
    notes: first?.notes || "",
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const save = useSaveOccupancy(roomId);
  const update = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  async function saveAll() {
    for (const slot of slots) {
      const current = currentOccupancy(slot.id, occupancies);
      const item = {
        ...(current || emptyOccupancy(slot.id, cageCode(slot, rack.index, roomName), today)),
        ...draft,
        slotId: slot.id,
        updatedAt: today,
      } as Occupancy;
      await save.mutateAsync({ item, exists: Boolean(current) });
    }
    onDone(`已批量保存 ${slots.length} 个笼位。`);
  }
  async function clearAll() {
    for (const slot of slots) {
      const current = currentOccupancy(slot.id, occupancies);
      if (current)
        await save.mutateAsync({
          item: { ...current, status: "ended", endDate: today, updatedAt: today },
          exists: true,
        });
    }
    onDone(`已将 ${slots.length} 个笼位设为空。`);
  }
  return (
    <ModalShell ariaLabel={`批量编辑 ${slots.length} 个笼位`} className="cage-slot-modal" onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2 id="batch-slot-title">批量编辑 {slots.length} 个笼位</h2>
          <p>{slots.map(slotPosition).join("、")}</p>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="modal-shell-body form compact-slot-form">
        <div className="compact-form-row third">
          <label>
            状态
            <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
              <option value="active">在用</option>
              <option value="reserved">已预约</option>
            </select>
          </label>
          <Field label="IACUC 编号" value={draft.iacuc} onChange={(value) => update("iacuc", value)} />
          <Field label="项目名称" value={draft.project} onChange={(value) => update("project", value)} />
        </div>
        <div className="compact-form-row half">
          <Field label="项目负责人" value={draft.pi} onChange={(value) => update("pi", value)} />
          <Field label="实验负责人" value={draft.owner} onChange={(value) => update("owner", value)} />
        </div>
        <div className="compact-form-row half">
          <Field
            label="开始日期"
            type="date"
            value={draft.startDate}
            onChange={(value) => update("startDate", value)}
          />
          <Field label="结束日期" type="date" value={draft.endDate} onChange={(value) => update("endDate", value)} />
        </div>
        <label>
          备注
          <textarea rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)} />
        </label>
      </div>
      <div className="modal-shell-actions">
        <button
          className="ghost danger-text"
          type="button"
          onClick={() => (confirmClear ? void clearAll() : setConfirmClear(true))}
        >
          {confirmClear ? "再次点击确认批量设空" : "批量设为空"}
        </button>
        <button className="primary" type="button" disabled={save.isPending} onClick={() => void saveAll()}>
          批量保存
        </button>
      </div>
    </ModalShell>
  );
}

export function ReserveBar({
  task,
  slot,
  rack,
  roomName,
  roomId,
  onDone,
}: {
  task?: PlacementTask;
  slot: CageSlot;
  rack?: CageRack;
  roomName: string;
  roomId: string;
  onDone: (message: string) => void;
}) {
  const reserve = useReservePlacement(roomId);
  if (!task || !rack) return null;
  return (
    <div className="cage-reserve-bar">
      <div>
        <strong>{task.batchNo}</strong>
        <span>预留到 {cageCode(slot, rack.index, roomName)}</span>
      </div>
      <button
        className="primary"
        type="button"
        disabled={reserve.isPending}
        onClick={async () => {
          await reserve.mutateAsync({ taskId: task.id, slotId: slot.id });
          onDone(`已为 ${task.batchNo} 预留笼位 ${cageCode(slot, rack.index, roomName)}。`);
        }}
      >
        确认预留
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  max,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  max?: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
