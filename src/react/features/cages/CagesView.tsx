import { useEffect, useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRoom, CageSlotStatus, RoomBootstrapResponse } from "../../api/contracts";
import { currentOccupancy } from "../../../domain/cages";
import {
  BatchSlotEditor,
  PlacementDrawer,
  ReserveBar,
  SlotEditor,
  VirtualRack,
} from "./components/CageWorkspaceComponents";
import { CageEmpty, CageLoading, Legend } from "./components/CageViewPrimitives";

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
                roomSpecies={selectedRoom?.defaultSpecies || ""}
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
          roomSpecies={selectedRoom?.defaultSpecies || ""}
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
