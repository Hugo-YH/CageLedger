import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useBootstrap } from "../../api/bootstrap";
import type {
  CageRack,
  CageRoom,
  CageSlot,
  CageSlotStatus,
  Occupancy,
  PlacementTask,
  RoomBootstrapResponse,
} from "../../api/contracts";
import { useMoveInPlacement, useReservePlacement, useSaveOccupancy } from "../../api/cages";
import { ModalShell } from "../../components/WorkspaceUi";
import { cageCode, currentOccupancy, emptyOccupancy, occupancyPeriodTone, slotPosition } from "../../../domain/cages";

const today = new Date().toISOString().slice(0, 10);

export function CagesView() {
  const summary = useBootstrap("summary");
  const rooms = (summary.data?.rooms || []) as unknown as CageRoom[];
  const [roomId, setRoomId] = useState("");
  const selectedRoomId = roomId || rooms[0]?.id || "";
  const roomQuery = useBootstrap("room", selectedRoomId, Boolean(selectedRoomId));
  const data = roomQuery.data as RoomBootstrapResponse | undefined;
  const racks = (data?.racks || []).filter((rack) => rack.roomId === selectedRoomId);
  const [rackId, setRackId] = useState("");
  const selectedRack = racks.find((rack) => rack.id === rackId) || racks[0];
  const [filter, setFilter] = useState<"all" | CageSlotStatus>("all");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchEditorOpen, setBatchEditorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const slots = (data?.slots || []).filter((slot) => slot.rackId === selectedRack?.id);
  const visibleSlots = filter === "all" ? slots : slots.filter((slot) => slot.status === filter);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) || null;
  const occupancies = data?.occupancies || [];
  const tasks = (data?.placementTasks || []).filter(
    (task) => task.targetRoomId === selectedRoomId && task.status !== "active" && task.status !== "cancelled",
  );
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId);

  useEffect(() => {
    setRackId("");
    setSelectedSlotId("");
    setSelectedSlotIds([]);
    setSelectedTaskId("");
  }, [selectedRoomId]);
  useEffect(() => {
    if (selectedRack && rackId && !racks.some((rack) => rack.id === rackId)) setRackId(selectedRack.id);
  }, [rackId, racks, selectedRack]);

  if (summary.isPending) return <CageLoading />;
  if (!rooms.length) return <CageEmpty />;

  return (
    <section className="workspace-view cage-workspace react-cage-view">
      <header className="workspace-head">
        <div className="workspace-head-main">
          <span className="workspace-kicker">笼位运营工作台</span>
          <div className="workspace-title-line">
            <h1>笼位管理</h1>
            <span className="workspace-status-badge">
              {selectedRoom?.name || "选择房间"} · {selectedRack?.name || "加载笼架"}
            </span>
          </div>
          <p>按房间和笼架查看占用、预约与饲养周期状态，选中笼位后集中维护。</p>
          <div className="workspace-meta-strip">
            <div className="workspace-meta-card">
              <span>当前笼架</span>
              <strong>{slots.length} 笼</strong>
            </div>
            <div className="workspace-meta-card warning">
              <span>待进驻</span>
              <strong>{tasks.length}</strong>
            </div>
            <div className="workspace-meta-card">
              <span>已选笼位</span>
              <strong>{selectedSlotIds.length || (selectedSlot ? 1 : 0)}</strong>
            </div>
          </div>
        </div>
        <div className="workspace-head-actions">
          <button className="secondary" type="button" onClick={() => setTasksOpen(true)}>
            待进驻 {tasks.length}
          </button>
        </div>
      </header>
      <div className="workspace-body cage-workspace-body">
        <section className="cage-layout">
          <div className="panel large cage-preview">
            <div className="panel-head">
              <div className="panel-title-line">
                <h2>动态笼位图</h2>
                <p>{visibleSlots.length} 个笼位</p>
              </div>
              <div className="panel-head-actions">
                <select aria-label="房间" value={selectedRoomId} onChange={(event) => setRoomId(event.target.value)}>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="笼架"
                  value={selectedRack?.id || ""}
                  onChange={(event) => {
                    setRackId(event.target.value);
                    setSelectedSlotId("");
                  }}
                >
                  {racks.map((rack) => (
                    <option key={rack.id} value={rack.id}>
                      {rack.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="legend">
              <Legend tone="empty" label="空" />
              <Legend tone="reserved" label="已预约" />
              <Legend tone="active" label="在用" />
              <Legend tone="period-open" label="未填结束日期" />
              <Legend tone="period-overdue" label="超期饲养" />
            </div>
            <div className="filter-row" role="group" aria-label="笼位状态筛选">
              {(["all", "active", "reserved", "empty"] as const).map((value) => (
                <button
                  key={value}
                  className={`segmented ${filter === value ? "active" : ""}`}
                  type="button"
                  onClick={() => setFilter(value)}
                >
                  {{ all: "全部", active: "在用", reserved: "已预约", empty: "空" }[value]}
                </button>
              ))}
              <button
                className={`segmented batch-toggle ${batchMode ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setBatchMode((value) => !value);
                  setSelectedSlotIds([]);
                  setSelectedSlotId("");
                }}
              >
                多选录入{selectedSlotIds.length ? ` (${selectedSlotIds.length})` : ""}
              </button>
              {batchMode ? (
                <>
                  <button
                    className="segmented"
                    type="button"
                    onClick={() => setSelectedSlotIds(visibleSlots.map((slot) => slot.id))}
                  >
                    全选当前
                  </button>
                  <button className="segmented" type="button" onClick={() => setSelectedSlotIds([])}>
                    清空选择
                  </button>
                </>
              ) : null}
            </div>
            {notice ? (
              <div className="react-inline-notice" role="status">
                {notice}
              </div>
            ) : null}
            {roomQuery.isPending ? (
              <CageLoading />
            ) : selectedRack ? (
              <VirtualRack
                rack={selectedRack}
                roomName={selectedRoom?.name || ""}
                slots={visibleSlots}
                occupancies={occupancies}
                selectedSlotId={selectedSlotId}
                selectedSlotIds={selectedSlotIds}
                onSelect={(slot) =>
                  batchMode
                    ? setSelectedSlotIds((current) =>
                        current.includes(slot.id) ? current.filter((id) => id !== slot.id) : [...current, slot.id],
                      )
                    : setSelectedSlotId(slot.id)
                }
              />
            ) : (
              <div className="empty-state">
                <h3>当前房间尚未创建笼架</h3>
              </div>
            )}
            {selectedTaskId && selectedSlot?.status === "empty" ? (
              <ReserveBar
                task={tasks.find((item) => item.id === selectedTaskId)}
                slot={selectedSlot}
                rack={selectedRack}
                roomName={selectedRoom?.name || ""}
                roomId={selectedRoomId}
                onDone={(message) => {
                  setNotice(message);
                  setSelectedTaskId("");
                  setSelectedSlotId("");
                }}
              />
            ) : null}
            {batchMode && selectedSlotIds.length ? (
              <div className="cage-reserve-bar">
                <div>
                  <strong>已选择 {selectedSlotIds.length} 个笼位</strong>
                  <span>统一维护项目与饲养日期</span>
                </div>
                <button className="primary" type="button" onClick={() => setBatchEditorOpen(true)}>
                  批量编辑
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      {selectedSlot && selectedRack && !selectedTaskId ? (
        <SlotEditor
          slot={selectedSlot}
          rack={selectedRack}
          roomName={selectedRoom?.name || ""}
          occupancy={currentOccupancy(selectedSlot.id, occupancies)}
          roomId={selectedRoomId}
          onClose={() => setSelectedSlotId("")}
          onNotice={setNotice}
        />
      ) : null}
      {batchEditorOpen && selectedRack ? (
        <BatchSlotEditor
          slots={slots.filter((slot) => selectedSlotIds.includes(slot.id))}
          rack={selectedRack}
          roomName={selectedRoom?.name || ""}
          occupancies={occupancies}
          roomId={selectedRoomId}
          onClose={() => setBatchEditorOpen(false)}
          onDone={(message) => {
            setNotice(message);
            setBatchEditorOpen(false);
            setSelectedSlotIds([]);
          }}
        />
      ) : null}
      {tasksOpen ? (
        <PlacementDrawer
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          roomId={selectedRoomId}
          onSelect={(task) => {
            setSelectedTaskId(task.id);
            setTasksOpen(false);
            setFilter("empty");
            setNotice("已选择待进驻任务，请在笼位图中选择空笼位。");
          }}
          onClose={() => setTasksOpen(false)}
        />
      ) : null}
    </section>
  );
}

function VirtualRack({
  rack,
  roomName,
  slots,
  occupancies,
  selectedSlotId,
  selectedSlotIds,
  onSelect,
}: {
  rack: CageRack;
  roomName: string;
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
    estimateSize: () => 126,
    overscan: 3,
  });
  return (
    <div className="react-rack-scroll" ref={scrollRef}>
      <div className="react-rack-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              className="react-rack-row"
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
                  <SlotButton
                    key={slot.id}
                    slot={slot}
                    rack={rack}
                    roomName={roomName}
                    occupancy={currentOccupancy(slot.id, occupancies)}
                    selected={slot.id === selectedSlotId || selectedSlotIds.includes(slot.id)}
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

function SlotButton({
  slot,
  rack,
  roomName,
  occupancy,
  selected,
  onClick,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  occupancy: Occupancy | null;
  selected: boolean;
  onClick: () => void;
}) {
  const tone = occupancyPeriodTone(occupancy, today);
  return (
    <button
      className={`slot ${slot.status} ${tone ? `period-${tone}` : ""} ${selected ? "selected" : ""}`}
      type="button"
      aria-label={`${cageCode(slot, rack.index, roomName)} ${occupancy?.iacuc || "空"}`}
      onClick={onClick}
    >
      <span className="slot-code">{cageCode(slot, rack.index, roomName)}</span>
      {occupancy ? (
        <>
          <strong className="slot-iacuc">{occupancy.iacuc || "未填写 IACUC"}</strong>
          <span className="slot-person">
            {occupancy.pi || "未填写PI"} / {occupancy.owner || "未填写负责人"}
          </span>
          <span className="slot-date">{occupancy.startDate || "未设置入住时间"}</span>
        </>
      ) : (
        <strong className="slot-empty-text">空</strong>
      )}
      <span className="slot-position">{slotPosition(slot)}</span>
    </button>
  );
}

function SlotEditor({
  slot,
  rack,
  roomName,
  occupancy,
  roomId,
  onClose,
  onNotice,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  occupancy: Occupancy | null;
  roomId: string;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(
    () => occupancy || emptyOccupancy(slot.id, cageCode(slot, rack.index, roomName), today),
  );
  const [confirmClear, setConfirmClear] = useState(false);
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

function PlacementDrawer({
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

function BatchSlotEditor({
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

function ReserveBar({
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
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="legend-item">
      <i className={`status-dot ${tone}`} />
      {label}
    </span>
  );
}
function CageLoading() {
  return (
    <div className="empty-state" aria-busy="true">
      <h3>正在加载笼位信息...</h3>
    </div>
  );
}
function CageEmpty() {
  return (
    <section className="workspace-view">
      <div className="empty-state">
        <h2>尚未创建饲养间</h2>
        <p>请先在房间管理中创建饲养间和笼架。</p>
      </div>
    </section>
  );
}
