import { useOperationFeedback } from "../../hooks/useOperationFeedback";
import { ActionIcon } from "../../components/ui/ActionIcon";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Flex, Select, Tooltip, Typography, theme } from "antd";

import { useRooms, useRoomWorkspace } from "../../api/infrastructure";
import type { CageRoom, SessionUser } from "../../api/contracts";
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
import { ActionButton, HelpPopover, ListRefreshStatus, ModalPresence } from "../../components/ui";
import { useReservePlacement } from "../../api/cages";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { useSelectionScope } from "../../hooks/useSelectionScope";

const zoomLevels = [1, 2, 3];
const detailZoomLevel = zoomLevels.length - 1;
const facilityLabels: Record<string, string> = { zhujiang: "珠江新城设施", bioisland: "生物岛设施" };

function roomFacility(room: CageRoom) {
  const facility = room.facility?.trim() || "zhujiang";
  return facility === "island" ? "bioisland" : facility;
}

type MapDestination = { rackId: string; focus: boolean } | { center: [number, number]; pointer?: [number, number] };
type MapTransition = { destination?: MapDestination; previousBounds?: DOMRect };

function panRoomMap(map: HTMLElement, destination: MapDestination) {
  const bounds = map.getBoundingClientRect();
  if ("rackId" in destination) {
    const rack = [...map.querySelectorAll<HTMLElement>("[data-rack-id]")].find(
      (item) => item.dataset.rackId === destination.rackId,
    );
    if (!rack) return;
    const target = rack.getBoundingClientRect();
    const controls = map.nextElementSibling?.getBoundingClientRect();
    const topPadding = controls && controls.left < bounds.right ? controls.bottom - bounds.top + 8 : 8;
    map.scrollLeft += target.left - bounds.left - Math.max(0, (map.clientWidth - target.width) / 2);
    map.scrollTop += target.top - bounds.top - topPadding;
    if (destination.focus) {
      const heading = rack instanceof HTMLButtonElement ? rack : rack.querySelector("button");
      heading?.focus({ preventScroll: true });
    }
  } else if (map.firstElementChild) {
    const board = map.firstElementChild.getBoundingClientRect();
    const x = destination.pointer?.[0] ?? bounds.left + map.clientWidth / 2;
    const y = destination.pointer?.[1] ?? bounds.top + map.clientHeight / 2;
    map.scrollLeft += board.left + destination.center[0] * board.width - x;
    map.scrollTop += board.top + destination.center[1] * board.height - y;
  }
}

function animateRoomMap(board: Element, before: DOMRect, timing: KeyframeAnimationOptions) {
  if (typeof board.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const after = board.getBoundingClientRect();
  if (!before.width || !before.height || !after.width || !after.height) return null;
  const translate = `translate(${before.left - after.left}px, ${before.top - after.top}px)`;
  const scale = `scale(${before.width / after.width}, ${before.height / after.height})`;
  return board.animate(
    [
      { transformOrigin: "0 0", transform: `${translate} ${scale}` },
      { transformOrigin: "0 0", transform: "none" },
    ],
    timing,
  );
}

export function CagesView({ user }: { user: SessionUser }) {
  const feedback = useOperationFeedback();
  const { token } = theme.useToken();
  const summary = useRooms();
  const rooms = summary.data?.items || [];
  const [facility, setFacility] = useState("");
  const [roomId, setRoomId] = useState("");
  const facilities = [...new Set(rooms.map(roomFacility))];
  const activeFacility = facilities.includes(facility) ? facility : "";
  const visibleRooms = activeFacility ? rooms.filter((room) => roomFacility(room) === activeFacility) : rooms;
  const selectedRoomId = visibleRooms.some((room) => room.id === roomId) ? roomId : "";
  const selectedRoom = visibleRooms.find((room) => room.id === selectedRoomId);
  const roomQuery = useRoomWorkspace(selectedRoomId, "cages");
  const data = roomQuery.data;
  const racks = useMemo(
    () => (data?.racks || []).filter((rack) => rack.roomId === selectedRoomId),
    [data?.racks, selectedRoomId],
  );
  const [rackId, setRackId] = useState("");
  const selectedRack = racks.find((rack) => rack.id === rackId);
  const [rackDetailsOpen, setRackDetailsOpen] = useState(false);
  const rackDetailsTrigger = useRef<HTMLElement | null>(null);
  const roomMap = useRef<HTMLDivElement>(null);
  const mapTransition = useRef<MapTransition | null>(null);
  const mapAnimation = useRef<Animation | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchEditorOpen, setBatchEditorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [reservationError, setReservationError] = useState("");
  const slots = useMemo(
    () => (data?.slots || []).filter((slot) => slot.rackId === selectedRack?.id),
    [data?.slots, selectedRack?.id],
  );
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) || null;
  const occupancies = data?.occupancies || [];
  const occupancyBySlot = useMemo(() => currentOccupancyIndex(data?.occupancies || []), [data?.occupancies]);
  const selectedOccupancy = occupancyBySlot.get(selectedSlotId) ?? null;
  const projectColors = useMemo(
    () => roomProjectColors(data?.slots || [], occupancyBySlot, token),
    [data?.slots, occupancyBySlot, token],
  );
  const placements = useMemo(
    () => arrangeRoomRacks(racks, data?.rackLayout?.placements || []),
    [racks, data?.rackLayout],
  );
  const today = localToday();
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
    [batchMode, setSelectedSlotId, setSelectedSlotIds],
  );
  const mapData = {
    racks,
    slots: data?.slots || [],
    occupancyBySlot,
    occupancyStrains: data?.occupancyStrains,
    roomName: selectedRoom?.name || "",
    roomSpecies: selectedRoom?.defaultSpecies || "",
    projectColors,
    today,
  };

  const reserve = useReservePlacement(selectedRoomId);
  const scopeOperations = useLatestRequest();
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedCount = batchMode ? selectedSlotIds.length : Number(Boolean(selectedSlot));

  useLayoutEffect(() => {
    const transition = mapTransition.current;
    mapTransition.current = null;
    const map = roomMap.current;
    if (!map || !transition) return;
    if (transition.destination) panRoomMap(map, transition.destination);
    const board = map.firstElementChild;
    if (board && transition.previousBounds) {
      mapAnimation.current = animateRoomMap(board, transition.previousBounds, {
        duration: Number.parseFloat(token.motionDurationMid) * 1000,
        easing: token.motionEaseOut,
      });
    }
  }, [zoomLevel, token.motionDurationMid, token.motionEaseOut]);

  useEffect(() => () => mapAnimation.current?.cancel(), []);

  function navigateRoomMap(level: number, destination?: MapDestination, pointer?: [number, number]) {
    const map = roomMap.current;
    const previousBounds = map?.firstElementChild?.getBoundingClientRect();
    if (map && !destination && map.firstElementChild) {
      const bounds = map.getBoundingClientRect();
      if (pointer && (pointer[0] < bounds.left || pointer[0] > bounds.right)) pointer = undefined;
      const x = pointer?.[0] ?? bounds.left + map.clientWidth / 2;
      const y = pointer?.[1] ?? bounds.top + map.clientHeight / 2;
      const board = map.firstElementChild.getBoundingClientRect();
      if (!pointer && level > zoomLevel) {
        let nearest = Infinity;
        for (const rack of map.querySelectorAll<HTMLElement>("[data-rack-id]")) {
          const target = rack.getBoundingClientRect();
          const distance = Math.hypot(target.left + target.width / 2 - x, target.top + target.height / 2 - y);
          if (distance < nearest && rack.dataset.rackId) {
            nearest = distance;
            destination = { rackId: rack.dataset.rackId, focus: false };
          }
        }
      }
      if (!destination && board.width && board.height) {
        destination = { center: [(x - board.left) / board.width, (y - board.top) / board.height], pointer };
      }
    }
    mapAnimation.current?.cancel();
    mapAnimation.current = null;
    if (level === zoomLevel) {
      if (map && destination) panRoomMap(map, destination);
      return;
    }
    mapTransition.current = { destination, previousBounds };
    setZoomLevel(level);
  }

  function changeRack(id: string) {
    if (id === rackId) return;
    if (selectedCount) void feedback.message.info("范围已变化，已清空选择");
    clearRackSelection();
    setRackId(id);
  }

  function changeRoom(id: string) {
    setRoomId(id);
    if (id === selectedRoomId) return;
    setRackId("");
    setRackDetailsOpen(false);
    rackDetailsTrigger.current = null;
    mapTransition.current = null;
    mapAnimation.current?.cancel();
    mapAnimation.current = null;
    setZoomLevel(0);
    setSelectedTaskId("");
    setTasksOpen(false);
    setLayoutEditorOpen(false);
    if (!id) setBatchMode(false);
  }

  function changeFacility(value: string) {
    setFacility(value);
    if (value && selectedRoom && roomFacility(selectedRoom) !== value) changeRoom("");
  }

  function showRackDetails(id = selectedRack?.id, trigger: HTMLElement | null = null) {
    if (!id) return;
    if (placements.some((placement) => placement.rackId === id)) {
      if (batchMode || selectedTask) changeRack(id);
      setRackDetailsOpen(false);
      navigateRoomMap(detailZoomLevel, { rackId: id, focus: true });
    } else {
      changeRack(id);
      rackDetailsTrigger.current = trigger;
      setRackDetailsOpen(true);
    }
  }

  const closeRackDetails = useCallback(() => {
    setRackDetailsOpen(false);
    const trigger = rackDetailsTrigger.current;
    (trigger?.isConnected ? trigger : roomMap.current)?.focus();
    rackDetailsTrigger.current = null;
  }, []);

  const clearRackSelection = useCallback(() => {
    scopeOperations.invalidate();
    setReservationError("");
    setSelectedSlotId("");
    setSelectedSlotIds([]);
    setBatchEditorOpen(false);
  }, [scopeOperations, setBatchEditorOpen, setReservationError, setSelectedSlotId, setSelectedSlotIds]);

  function clearSelection() {
    clearRackSelection();
    setSelectedTaskId("");
    setTasksOpen(false);
  }
  useSelectionScope(selectedRoomId, clearRackSelection, Boolean(selectedSlotId) || selectedSlotIds.length > 0);

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
        feedback.success("笼位已预留", `${task.batchNo} · ${code}`);
        clearSelection();
      }
    } catch (error) {
      if (isCurrent()) setReservationError(error instanceof Error ? error.message : "预留失败");
    }
  }
  useEffect(() => {
    if (data && rackId && !selectedRack) {
      clearRackSelection();
      setRackId("");
      setRackDetailsOpen(false);
    }
  }, [clearRackSelection, data, rackId, selectedRack]);

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
                : selectedRack && (rackDetailsOpen || zoomLevel === detailZoomLevel)
                  ? `${selectedRack.name} · 请选择空笼位`
                  : "请在房间图选择笼架"}
            </span>
          ) : (
            <span>{batchMode ? `多选录入 · ${selectedRack?.name ?? "请在房间图选择笼架"}` : "单笼录入"}</span>
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
                disabled={!data}
                onClick={() => {
                  clearSelection();
                  setBatchMode((value) => !value);
                  if (!batchMode) {
                    setRackId("");
                    setRackDetailsOpen(false);
                  }
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
          <Card
            className="cage-room-workbench cage-room-panel"
            title={
              <Flex className="cage-room-heading" align="center" gap={8} wrap>
                <Flex align="center" gap={8}>
                  <label htmlFor="cages-facility-select">设施</label>
                  <Select
                    aria-label="设施"
                    className="cage-facility-select"
                    id="cages-facility-select"
                    options={[
                      { label: "全部设施", value: "" },
                      ...facilities.map((value) => ({ label: facilityLabels[value] || value, value })),
                    ]}
                    value={activeFacility}
                    onChange={changeFacility}
                  />
                </Flex>
                <Flex align="center" gap={8}>
                  <h3 className="cage-room-panel-title">饲养间</h3>
                  <Select
                    aria-label="房间"
                    className="cage-room-select"
                    id="cages-room-select"
                    options={[
                      { label: "请选择饲养间", value: "" },
                      ...visibleRooms.map((room) => ({ label: room.name, value: room.id })),
                    ]}
                    value={selectedRoomId}
                    onChange={changeRoom}
                  />
                </Flex>
                {data ? (
                  <Flex align="center" gap={4}>
                    <Typography.Text type="secondary">{racks.length} 个笼架</Typography.Text>
                    {racks.length ? (
                      <HelpPopover label="房间图操作说明">
                        {zoomLevel === detailZoomLevel ? "点击笼位操作。" : "点击笼架查看详情。"}
                      </HelpPopover>
                    ) : null}
                  </Flex>
                ) : null}
                <ListRefreshStatus active={roomQuery.isFetching && Boolean(data)} />
              </Flex>
            }
            extra={
              canEditLayout && racks.length ? (
                <ActionButton icon={<ActionIcon name="edit" />} onClick={() => setLayoutEditorOpen(true)}>
                  编辑布局
                </ActionButton>
              ) : null
            }
            styles={{
              header: { paddingInline: token.padding, flexWrap: "wrap", gap: token.paddingXS },
              body: { padding: token.padding },
            }}
          >
            {!selectedRoomId ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择饲养间查看笼架" />
            ) : roomQuery.isPending ? (
              <CageLoading />
            ) : roomQuery.isError && !data ? (
              <PageState
                title="笼位信息加载失败"
                detail="请重试加载当前饲养间。"
                retry={() => void roomQuery.refetch()}
              />
            ) : (
              <Flex vertical gap={12}>
                <div className="cage-room-map-stage">
                  <div className="cage-room-map-base">
                    <RoomRackMap
                      {...mapData}
                      placements={placements}
                      selectedRackId={
                        (batchMode || selectedTask) && (rackDetailsOpen || zoomLevel === detailZoomLevel)
                          ? selectedRack?.id
                          : undefined
                      }
                      onSelect={showRackDetails}
                      onSelectSlot={(slot) => {
                        changeRack(slot.rackId);
                        setRackDetailsOpen(false);
                        selectSlot(slot);
                      }}
                      selectedSlotIds={batchMode ? selectedSlotIdSet : new Set(selectedSlotId ? [selectedSlotId] : [])}
                      onOverview={(id) => navigateRoomMap(0, id ? { rackId: id, focus: true } : undefined)}
                      onZoomGesture={(direction, pointer) => {
                        const level =
                          direction === 0 ? 0 : Math.max(0, Math.min(detailZoomLevel, zoomLevel + direction));
                        if (level !== zoomLevel) navigateRoomMap(level, undefined, pointer);
                      }}
                      zoom={zoomLevels[zoomLevel]}
                      regionRef={roomMap}
                      controls={
                        <Flex className="cage-room-zoom" align="center" gap={4} role="group" aria-label="房间图缩放">
                          <Tooltip title="缩小房间图">
                            <Button
                              aria-label="缩小房间图"
                              icon={<ZoomOutOutlined aria-hidden />}
                              disabled={zoomLevel === 0}
                              onClick={() => navigateRoomMap(zoomLevel - 1)}
                            />
                          </Tooltip>
                          <Button
                            className="cage-room-zoom-level"
                            type="text"
                            aria-label="恢复房间图比例"
                            onClick={() => navigateRoomMap(0)}
                          >
                            {zoomLevels[zoomLevel] * 100}%
                          </Button>
                          <Tooltip title="放大房间图">
                            <Button
                              aria-label="放大房间图"
                              icon={<ZoomInOutlined aria-hidden />}
                              disabled={zoomLevel === detailZoomLevel}
                              onClick={() => navigateRoomMap(zoomLevel + 1)}
                            />
                          </Tooltip>
                        </Flex>
                      }
                    />
                  </div>
                  {selectedRack && rackDetailsOpen ? (
                    <RoomRackDetails
                      key={selectedRack.id}
                      rack={selectedRack}
                      roomName={selectedRoom?.name || ""}
                      roomSpecies={selectedRoom?.defaultSpecies || ""}
                      slots={slots}
                      occupancyBySlot={occupancyBySlot}
                      occupancyStrains={data?.occupancyStrains}
                      projectColors={projectColors}
                      today={today}
                      selectedSlotId={selectedSlotId}
                      selectedSlotIds={selectedSlotIds}
                      onSelect={selectSlot}
                      onClose={closeRackDetails}
                    />
                  ) : null}
                </div>
                {racks.length ? <RoomRackLegend /> : null}
              </Flex>
            )}
          </Card>
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
            rackId={selectedRack?.id || racks[0]?.id || ""}
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
            occupancy={selectedOccupancy}
            strain={selectedOccupancy ? data?.occupancyStrains?.[selectedOccupancy.id] : undefined}
            intakeDetails={selectedOccupancy ? data?.occupancyIntakeDetails?.[selectedOccupancy.id] : undefined}
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
              setRackId("");
              setRackDetailsOpen(false);
              setSelectedTaskId(task.id);
              setTasksOpen(false);
            }}
            onClose={() => setTasksOpen(false)}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
