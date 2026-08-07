import { useEffect, useState } from "react";
import { Button, Select } from "antd";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRoom, RoomBootstrapResponse } from "../../api/contracts";
import { currentOccupancy } from "../../../domain/cages";
import {
  BatchSlotEditor,
  PlacementDrawer,
  ReserveBar,
  SlotEditor,
  VirtualRack,
} from "./components/CageWorkspaceComponents";
import { CageEmpty, CageLoading, Legend } from "./components/CageViewPrimitives";
import { WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ActionButton } from "../../components/ui";

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
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchEditorOpen, setBatchEditorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const slots = (data?.slots || []).filter((slot) => slot.rackId === selectedRack?.id);
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
    <section className="workspace-view cage-workspace react-cage-view" data-feature="cages">
      <WorkspaceToolbar
        actions={
          <>
            <ActionButton onClick={() => setTasksOpen(true)}>待进驻 {tasks.length}</ActionButton>
            <ActionButton
              tone="primary"
              onClick={() => {
                setBatchMode((value) => !value);
                setSelectedSlotIds([]);
                setSelectedSlotId("");
              }}
            >
              多选录入{selectedSlotIds.length ? ` (${selectedSlotIds.length})` : ""}
            </ActionButton>
            {batchMode ? (
              <>
                <Button onClick={() => setSelectedSlotIds(slots.map((slot) => slot.id))}>全选当前</Button>
                <Button onClick={() => setSelectedSlotIds([])}>清空选择</Button>
              </>
            ) : null}
          </>
        }
        toolbar={
          <>
            <label className="workspace-toolbar-field" htmlFor="cages-room-select">
              <span>饲养间</span>
              <Select
                aria-label="房间"
                id="cages-room-select"
                options={rooms.map((room) => ({ label: room.name, value: room.id }))}
                value={selectedRoomId}
                onChange={setRoomId}
              />
            </label>
            <label className="workspace-toolbar-field" htmlFor="cages-rack-select">
              <span>笼架</span>
              <Select
                aria-label="笼架"
                id="cages-rack-select"
                options={racks.map((rack) => ({ label: rack.name, value: rack.id }))}
                value={selectedRack?.id || ""}
                onChange={(value) => {
                  setRackId(value);
                  setSelectedSlotId("");
                }}
              />
            </label>
          </>
        }
      />
      <div className="workspace-body cage-workspace-body">
        <section className="cage-layout">
          <div className="panel large cage-preview">
            <div className="panel-head">
              <div className="panel-title-line">
                <h2>动态笼位图</h2>
                <p>{slots.length} 个笼位</p>
              </div>
            </div>
            <div className="legend">
              <Legend tone="empty" label="空" />
              <Legend tone="reserved" label="已预约" />
              <Legend tone="active" label="在用" />
              <Legend tone="period-open" label="未填结束日期" />
              <Legend tone="period-overdue" label="超期饲养" />
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
                slots={slots}
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
                <ActionButton tone="primary" onClick={() => setBatchEditorOpen(true)}>
                  批量编辑
                </ActionButton>
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
            setNotice("已选择待进驻任务，请在笼位图中选择空笼位。");
          }}
          onClose={() => setTasksOpen(false)}
        />
      ) : null}
    </section>
  );
}
