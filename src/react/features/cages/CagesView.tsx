import { useOperationFeedback } from "../../hooks/useOperationFeedback";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Flex, Select, Typography, theme } from "antd";

import { useRooms, useRoomWorkspace } from "../../api/infrastructure";
import type { SessionUser } from "../../api/contracts";
import { cageCode, currentOccupancyIndex } from "../../../domain/cages";
import { localToday } from "../../../domain/iacucValidity";
import { arrangeRoomRacks } from "../../../domain/rackLayout";
import { BatchSlotEditor, PlacementDrawer, SlotEditor } from "./components/CageWorkspaceComponents";
import { CageEmpty, CageLoading } from "./components/CageViewPrimitives";
import { RoomRackLayoutEditor } from "./components/RoomRackLayoutEditor";
import { RoomRackLegend, RoomRackMap } from "./components/RoomRackMap";
import { RoomRackDetails } from "./components/RoomRackDetails";
import { roomProjectColors } from "./components/roomProjectColors";
import { PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ActionButton, ListRefreshStatus, ModalPresence } from "../../components/ui";
import { useReservePlacement } from "../../api/cages";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { useSelectionScope } from "../../hooks/useSelectionScope";

export function CagesView({ user }: { user: SessionUser }) {
  const feedback = useOperationFeedback();
  const { token } = theme.useToken();
  const summary = useRooms();
  const rooms = summary.data?.items || [];
  const [roomId, setRoomId] = useState("");
  const selectedRoomId = roomId || rooms[0]?.id || "";
  const roomQuery = useRoomWorkspace(selectedRoomId, "cages");
  const data = roomQuery.data;
  const racks = useMemo(
    () => (data?.racks || []).filter((rack) => rack.roomId === selectedRoomId),
    [data?.racks, selectedRoomId],
  );
  const [rackId, setRackId] = useState("");
  const selectedRack = racks.find((rack) => rack.id === rackId) || racks[0];
  const [rackDetails, setRackDetails] = useState<{ rackId: string; focusOnOpen: boolean } | null>(null);
  const rackDetailsTrigger = useRef<HTMLElement | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchEditorOpen, setBatchEditorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [reservationError, setReservationError] = useState("");
  const slots = useMemo(
    () => (data?.slots || []).filter((slot) => slot.rackId === selectedRack?.id),
    [data?.slots, selectedRack?.id],
  );
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) || null;
  const occupancies = data?.occupancies || [];
  const occupancyBySlot = useMemo(() => currentOccupancyIndex(data?.occupancies || []), [data?.occupancies]);
  const projectColors = useMemo(() => roomProjectColors(occupancyBySlot.values(), token), [occupancyBySlot, token]);
  const placements = useMemo(
    () => arrangeRoomRacks(racks, data?.rackLayout?.placements || []),
    [racks, data?.rackLayout],
  );
  const today = localToday();
  const mapData = { racks, slots: data?.slots || [], occupancyBySlot, projectColors, today };
  const canEditLayout = user.role === "admin" || (user.role === "room_admin" && user.roomIds.includes(selectedRoomId));
  const selectedSlotIdSet = useMemo(() => new Set(selectedSlotIds), [selectedSlotIds]);
  const selectedSlots = useMemo(
    () => slots.filter((slot) => selectedSlotIdSet.has(slot.id)),
    [slots, selectedSlotIdSet],
  );
  const tasks = useMemo(
    () =>
      (data?.placementTasks || []).filter(
        (task) => task.targetRoomId === selectedRoomId && task.status !== "active" && task.status !== "cancelled",
      ),
    [data?.placementTasks, selectedRoomId],
  );
  const selectSlot = useCallback(
    (slot: (typeof slots)[number]) => {
      if (batchMode)
        setSelectedSlotIds((current) =>
          current.includes(slot.id) ? current.filter((id) => id !== slot.id) : [...current, slot.id],
        );
      else setSelectedSlotId(slot.id);
    },
    [batchMode],
  );
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId);

  const reserve = useReservePlacement(selectedRoomId);
  const scopeOperations = useLatestRequest();
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedCount = batchMode ? selectedSlotIds.length : Number(Boolean(selectedSlot));

  function showRackDetails(id = selectedRack?.id, trigger: HTMLElement | null = null, focusOnOpen = true) {
    if (!id || id === rackDetails?.rackId) return;
    rackDetailsTrigger.current = trigger;
    setRackId(id);
    setRackDetails({ rackId: id, focusOnOpen });
  }

  const closeRackDetails = useCallback(() => {
    setRackDetails(null);
    const trigger = rackDetailsTrigger.current;
    (trigger?.isConnected ? trigger : document.getElementById("cages-rack-select"))?.focus();
    rackDetailsTrigger.current = null;
  }, []);

  function clearSelection() {
    scopeOperations.invalidate();
    setReservationError("");
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
    setReservationError("");
    // Capture the selected targets before the write; changing rooms only clears the UI selection.
    const task = selectedTask;
    const slot = selectedSlot;
    const code = cageCode(slot, selectedRack.index, selectedRoom?.name || "");
    try {
      await reserve.mutateAsync({ taskId: task.id, slotId: slot.id });
      if (isCurrent()) {
        setNotice("");
        feedback.success("笼位已预留", `${task.batchNo} · ${code}`);
        clearSelection();
      }
    } catch (error) {
      if (isCurrent()) setReservationError(error instanceof Error ? error.message : "预留失败");
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
        <WorkspaceToolbar
          title="笼位管理"
          ariaLabel="笼位图操作"
          context={<ListRefreshStatus active={summary.isFetching} />}
        />
        <CageEmpty />
      </>
    );
  }

  return (
    <section className="workspace-view cage-workspace react-cage-view" data-feature="cages">
      <WorkspaceToolbar
        ariaLabel="笼位图操作"
        title="笼位管理"
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
            <ActionButton icon={<ActionIcon name="select" />} disabled={!data} onClick={() => setTasksOpen(true)}>
              待进驻 {data ? tasks.length : ""}
            </ActionButton>
            {selectedTask ? (
              <ActionButton icon={<ActionIcon name="undo" />} onClick={clearSelection}>
                取消预留
              </ActionButton>
            ) : (
              <ActionButton
                icon={<ActionIcon name={batchMode ? "clear" : "select"} />}
                aria-pressed={batchMode}
                onClick={(event) => {
                  clearSelection();
                  setBatchMode((value) => !value);
                  if (!batchMode) showRackDetails(undefined, event.currentTarget);
                }}
              >
                {batchMode ? "退出多选" : "多选录入"}
              </ActionButton>
            )}
            {batchMode ? (
              <Button
                icon={<ActionIcon name="select" />}
                disabled={!slots.length || roomQuery.isFetching}
                onClick={(event) => {
                  showRackDetails(undefined, event.currentTarget);
                  setSelectedSlotIds(slots.map((slot) => slot.id));
                }}
              >
                全选当前
              </Button>
            ) : null}
          </>
        }
        primaryAction={
          selectedTask ? (
            <ActionButton
              icon={<ActionIcon name="reserve" />}
              disabled={!selectedSlot || selectedSlot.status !== "empty" || reserve.isPending}
              loading={reserve.isPending}
              tone="primary"
              onClick={() => void reserveSelected()}
            >
              确认预留
            </ActionButton>
          ) : batchMode ? (
            <ActionButton
              icon={<ActionIcon name="edit" />}
              disabled={!selectedSlotIds.length}
              tone="primary"
              onClick={() => setBatchEditorOpen(true)}
            >
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
                  setRackDetails(null);
                  setLayoutEditorOpen(false);
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
                onSelect={(id) => showRackDetails(id, document.getElementById("cages-rack-select"))}
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
            <Button
              icon={<ActionIcon name="refresh" />}
              loading={summary.isFetching}
              onClick={() => void summary.refetch()}
            >
              重试
            </Button>
          }
        />
      ) : null}
      <div className="workspace-body cage-workspace-body">
        <Flex vertical gap={16}>
          {reservationError ? <Alert role="alert" type="error" showIcon title={reservationError} /> : null}
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
                <Button
                  icon={<ActionIcon name="refresh" />}
                  loading={roomQuery.isFetching}
                  onClick={() => void roomQuery.refetch()}
                >
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
          ) : (
            <div className="cage-room-workbench">
              <Card
                className="cage-room-panel"
                title={<h3 className="cage-room-panel-title">{selectedRoom?.name} · 房间布局</h3>}
                extra={
                  canEditLayout && racks.length ? (
                    <ActionButton icon={<ActionIcon name="edit" />} onClick={() => setLayoutEditorOpen(true)}>
                      编辑布局
                    </ActionButton>
                  ) : null
                }
              >
                <Flex vertical gap={16}>
                  {racks.length ? (
                    <Typography.Text type="secondary">{racks.length} 个笼架 · 选择笼架查看笼位</Typography.Text>
                  ) : null}
                  <div className="cage-room-map-stage">
                    <div className="cage-room-map-base">
                      <RoomRackMap
                        {...mapData}
                        placements={placements}
                        selectedRackId={rackDetails?.rackId}
                        onSelect={showRackDetails}
                      />
                    </div>
                    {selectedRack && rackDetails?.rackId === selectedRack.id ? (
                      <RoomRackDetails
                        key={selectedRack.id}
                        rack={selectedRack}
                        roomName={selectedRoom?.name || ""}
                        roomSpecies={selectedRoom?.defaultSpecies || ""}
                        slots={slots}
                        occupancyBySlot={occupancyBySlot}
                        projectColors={projectColors}
                        today={today}
                        selectedSlotId={selectedSlotId}
                        selectedSlotIds={selectedSlotIds}
                        onSelect={selectSlot}
                        onClose={closeRackDetails}
                        focusOnOpen={rackDetails.focusOnOpen}
                      />
                    ) : null}
                  </div>
                  {racks.length ? <RoomRackLegend colors={projectColors} /> : null}
                </Flex>
              </Card>
            </div>
          )}
        </Flex>
      </div>
      <ModalPresence>
        {layoutEditorOpen && canEditLayout && data ? (
          <RoomRackLayoutEditor
            key={selectedRoomId}
            roomId={selectedRoomId}
            roomName={selectedRoom?.name || ""}
            updatedAt={data.rackLayout?.updatedAt || ""}
            layout={placements}
            mapData={mapData}
            rackId={selectedRack?.id || ""}
            onClose={() => setLayoutEditorOpen(false)}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {selectedSlot && selectedRack && !selectedTaskId ? (
          <SlotEditor
            key={selectedSlot.id}
            slot={selectedSlot}
            rack={selectedRack}
            roomName={selectedRoom?.name || ""}
            roomSpecies={selectedRoom?.defaultSpecies || ""}
            occupancy={occupancyBySlot.get(selectedSlot.id) || null}
            roomId={selectedRoomId}
            onClose={() => setSelectedSlotId("")}
            beginOperation={scopeOperations.begin}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {batchEditorOpen && selectedRack ? (
          <BatchSlotEditor
            key={selectedRack.id}
            slots={selectedSlots}
            rack={selectedRack}
            roomName={selectedRoom?.name || ""}
            occupancies={occupancies}
            roomId={selectedRoomId}
            onClose={() => {
              scopeOperations.invalidate();
              setBatchEditorOpen(false);
            }}
            beginOperation={scopeOperations.begin}
            onDone={(message) => {
              setNotice("");
              feedback.success(message);
              setBatchEditorOpen(false);
              setSelectedSlotIds([]);
            }}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {tasksOpen ? (
          <PlacementDrawer
            key={selectedRoomId}
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            roomId={selectedRoomId}
            onSelect={(task) => {
              clearSelection();
              setBatchMode(false);
              setSelectedTaskId(task.id);
              setTasksOpen(false);
              showRackDetails(selectedRack?.id, null, false);
              setNotice("已选择待进驻任务，请在笼位图中选择空笼位。");
            }}
            onClose={() => setTasksOpen(false)}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
