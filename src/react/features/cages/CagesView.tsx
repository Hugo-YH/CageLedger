import { useEffect, useState } from "react";
import { Alert, Button, Select } from "antd";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRoom, RoomBootstrapResponse } from "../../api/contracts";
import { cageCode, currentOccupancy } from "../../../domain/cages";
import { BatchSlotEditor, PlacementDrawer, SlotEditor, VirtualRack } from "./components/CageWorkspaceComponents";
import { CageEmpty, CageLoading, Legend } from "./components/CageViewPrimitives";
import { PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ActionButton, ListRefreshStatus } from "../../components/ui";
import { useReservePlacement } from "../../api/cages";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { useSelectionScope } from "../../hooks/useSelectionScope";

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

  const reserve = useReservePlacement(selectedRoomId);
  const scopeOperations = useLatestRequest();
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedCount = batchMode ? selectedSlotIds.length : Number(Boolean(selectedSlot));

  function clearSelection() {
    scopeOperations.invalidate();
    setSelectedSlotId("");
    setSelectedSlotIds([]);
    setSelectedTaskId("");
    setBatchEditorOpen(false);
    setTasksOpen(false);
  }
  useSelectionScope(
    JSON.stringify([selectedRoomId, selectedRack?.id || ""]),
    clearSelection,
    Boolean(selectedSlotId) || selectedSlotIds.length > 0 || Boolean(selectedTaskId),
  );

  async function reserveSelected() {
    if (!selectedTask || !selectedSlot || !selectedRack || selectedSlot.status !== "empty") return;
    const isCurrent = scopeOperations.begin();
    // Capture the selected targets before the write; changing rooms only clears the UI selection.
    const task = selectedTask;
    const slot = selectedSlot;
    const code = cageCode(slot, selectedRack.index, selectedRoom?.name || "");
    try {
      await reserve.mutateAsync({ taskId: task.id, slotId: slot.id });
      if (isCurrent()) {
        setNotice(`已为 ${task.batchNo} 预留笼位 ${code}。`);
        clearSelection();
      }
    } catch (error) {
      if (isCurrent()) setNotice(error instanceof Error ? error.message : "预留失败");
    }
  }
  useEffect(() => {
    if (selectedRack && rackId && !racks.some((rack) => rack.id === rackId)) setRackId(selectedRack.id);
  }, [rackId, racks, selectedRack]);

  if (summary.isPending) return <CageLoading />;
  if (summary.isError && !rooms.length) {
    return <PageState title="饲养间加载失败" detail="请重试加载饲养间信息。" retry={() => void summary.refetch()} />;
  }
  if (!rooms.length) {
    return (
      <>
        <ListRefreshStatus active={summary.isFetching} />
        <CageEmpty />
      </>
    );
  }

  return (
    <section className="workspace-view cage-workspace react-cage-view" data-feature="cages">
      <WorkspaceToolbar
        ariaLabel="笼位图操作"
        sticky={selectedTaskId ? true : "selection"}
        context={
          selectedTask ? (
            <span>
              {selectedTask.batchNo} ·{" "}
              {selectedSlot?.status === "empty" && selectedRack
                ? `预留到 ${cageCode(selectedSlot, selectedRack.index, selectedRoom?.name || "")}`
                : "请选择空笼位"}
            </span>
          ) : (
            <span>{batchMode ? "多选录入" : "单笼录入"}</span>
          )
        }
        selection={{
          count: selectedCount,
          onClear: clearSelection,
          pending: reserve.isPending,
        }}
        actions={
          <>
            <ActionButton disabled={!data} onClick={() => setTasksOpen(true)}>
              待进驻 {data ? tasks.length : ""}
            </ActionButton>
            {selectedTask ? (
              <ActionButton onClick={clearSelection}>取消预留</ActionButton>
            ) : (
              <ActionButton
                aria-pressed={batchMode}
                onClick={() => {
                  clearSelection();
                  setBatchMode((value) => !value);
                }}
              >
                {batchMode ? "退出多选" : "多选录入"}
              </ActionButton>
            )}
            {batchMode ? (
              <Button
                disabled={!slots.length || roomQuery.isFetching}
                onClick={() => setSelectedSlotIds(slots.map((slot) => slot.id))}
              >
                全选当前
              </Button>
            ) : null}
          </>
        }
        primaryAction={
          selectedTask ? (
            <ActionButton
              disabled={!selectedSlot || selectedSlot.status !== "empty" || reserve.isPending}
              loading={reserve.isPending}
              tone="primary"
              onClick={() => void reserveSelected()}
            >
              确认预留
            </ActionButton>
          ) : batchMode ? (
            <ActionButton disabled={!selectedSlotIds.length} tone="primary" onClick={() => setBatchEditorOpen(true)}>
              批量编辑
            </ActionButton>
          ) : null
        }
        filters={
          <>
            <label className="workspace-toolbar-field" htmlFor="cages-room-select">
              <span>饲养间</span>
              <Select
                aria-label="房间"
                id="cages-room-select"
                options={rooms.map((room) => ({ label: room.name, value: room.id }))}
                value={selectedRoomId}
                onChange={(value) => {
                  setRoomId(value);
                  setRackId("");
                }}
              />
            </label>
            <label className="workspace-toolbar-field" htmlFor="cages-rack-select">
              <span>笼架</span>
              <Select
                aria-label="笼架"
                loading={roomQuery.isPending}
                disabled={!data}
                id="cages-rack-select"
                options={racks.map((rack) => ({ label: rack.name, value: rack.id }))}
                value={selectedRack?.id || ""}
                onChange={setRackId}
              />
            </label>
          </>
        }
      />
      {summary.isError ? (
        <Alert
          type="error"
          showIcon
          title="饲养间更新失败，暂显示上次结果"
          action={
            <Button loading={summary.isFetching} onClick={() => void summary.refetch()}>
              重试
            </Button>
          }
        />
      ) : null}
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
            <ListRefreshStatus active={roomQuery.isFetching && Boolean(data)} />
            {roomQuery.isError && data ? (
              <Alert
                type="error"
                showIcon
                title="笼位信息更新失败，暂显示上次结果"
                action={
                  <Button loading={roomQuery.isFetching} onClick={() => void roomQuery.refetch()}>
                    重试
                  </Button>
                }
              />
            ) : null}
            {roomQuery.isPending ? (
              <CageLoading />
            ) : roomQuery.isError && !data ? (
              <PageState
                title="笼位信息加载失败"
                detail="请重试加载当前饲养间。"
                retry={() => void roomQuery.refetch()}
              />
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
          beginOperation={scopeOperations.begin}
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
          beginOperation={scopeOperations.begin}
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
            clearSelection();
            setBatchMode(false);
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
