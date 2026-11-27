import { Button, Empty, Flex, Typography } from "antd";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  cageDisplayStatus,
  cageOccupancyPeople,
  cageSpecies,
  cageStatusLabels,
  slotPosition,
} from "../../../../domain/cages";
import { speciesLabel } from "../../../../domain/intake";
import {
  rackFootprint,
  rackLayoutGridDivisions,
  rackLayoutSize,
  rackOverviewBounds,
  rackPlacementFits,
} from "../../../../domain/rackLayout";
import type { CageRack, CageSlot, Occupancy, RackPlacement } from "../../../api/contracts";
import { CageSlotButton } from "./CageSlotButton";
import { cageProjectKey } from "./roomProjectColors";

export interface RoomRackMapData {
  racks: readonly CageRack[];
  slots: readonly CageSlot[];
  occupancyBySlot: ReadonlyMap<string, Occupancy>;
  occupancyStrains?: Readonly<Record<string, string>>;
  roomName: string;
  roomSpecies: string;
  projectColors: ReadonlyMap<string, string>;
  today: string;
}

function placementStyle(
  placement: RackPlacement,
  bounds: ReturnType<typeof rackOverviewBounds>,
  rack: CageRack,
  grid = rackGrid(rack, placement.rotation),
): CSSProperties {
  const footprint = rackFootprint(placement.rotation, rack);
  return {
    insetInlineStart: `${((placement.column - bounds.column) / bounds.columns) * 100}%`,
    insetBlockStart: `${((placement.row - bounds.row) / bounds.rows) * 100}%`,
    inlineSize: `${(footprint.columns / bounds.columns) * 100}%`,
    blockSize: `${(footprint.rows / bounds.rows) * 100}%`,
    "--rack-footprint-columns": footprint.columns,
    "--rack-footprint-rows": footprint.rows,
    "--rack-slot-columns": grid.columns,
    "--rack-slot-rows": grid.rows,
  } as CSSProperties;
}

function rackGrid(rack: CageRack, rotation: RackPlacement["rotation"]) {
  const columns = Math.max(1, rack.cols || 1);
  const rows = Math.max(1, rack.rows || 1);
  if (rotation === 90) {
    return {
      columns: rows,
      rows: columns,
      position: (slot: CageSlot) => ({ column: rows - slot.row + 1, row: slot.col }),
    };
  }
  return { columns, rows, position: (slot: CageSlot) => ({ column: slot.col, row: slot.row }) };
}

export function RoomRackMap({
  racks,
  slots,
  occupancyBySlot,
  occupancyStrains,
  roomName,
  roomSpecies,
  projectColors,
  today,
  placements,
  selectedRackId,
  onSelect,
  onMove,
  disabled = false,
  zoom = 1,
  regionRef,
  onSelectSlot,
  selectedSlotIds,
  onOverview,
  controls,
  onZoomGesture,
}: RoomRackMapData & {
  placements: readonly RackPlacement[];
  selectedRackId?: string;
  onSelect: (rackId: string, trigger?: HTMLElement) => void;
  onMove?: (placement: RackPlacement) => void;
  disabled?: boolean;
  zoom?: number;
  regionRef?: React.Ref<HTMLDivElement>;
  onSelectSlot?: (slot: CageSlot) => void;
  selectedSlotIds?: ReadonlySet<string>;
  onOverview?: (rackId?: string) => void;
  controls?: ReactNode;
  onZoomGesture?: (direction: -1 | 0 | 1, pointer?: [number, number]) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    pointer: number;
    placement: RackPlacement;
    x: number;
    y: number;
    unitX: number;
    unitY: number;
  } | null>(null);
  const [dragTarget, setDragTarget] = useState<RackPlacement | null>(null);
  const dropTarget = useRef<RackPlacement | null>(null);
  const lastWheelZoom = useRef(-Infinity);
  const sizes = useMemo(() => new Map(racks.map((rack) => [rack.id, rack])), [racks]);
  const bounds = onMove
    ? { column: 0, row: 0, ...rackLayoutSize(placements, sizes) }
    : rackOverviewBounds(placements, sizes);
  const { columns, rows } = bounds;
  const showDetails = Boolean(onSelectSlot) && zoom >= 3;
  const showSummary = !onMove && zoom === 2;
  const placementsByRack = new Map(placements.map((placement) => [placement.rackId, placement]));
  let detailColumnsPerUnit = 0;
  let detailRowsPerUnit = 0;
  if (showDetails) {
    for (const rack of racks) {
      const placement = placementsByRack.get(rack.id);
      if (!placement) continue;
      const footprint = rackFootprint(placement.rotation, rack);
      const grid = rackGrid(rack, placement.rotation);
      detailColumnsPerUnit = Math.max(detailColumnsPerUnit, grid.columns / footprint.columns);
      detailRowsPerUnit = Math.max(detailRowsPerUnit, grid.rows / footprint.rows);
    }
  }
  const slotsByRack = useMemo(() => {
    const grouped = new Map<string, CageSlot[]>();
    for (const slot of slots) {
      const group = grouped.get(slot.rackId);
      if (group) group.push(slot);
      else grouped.set(slot.rackId, [slot]);
    }
    return grouped;
  }, [slots]);

  useEffect(() => {
    const map = board.current?.parentElement;
    if (!map || !showDetails || !onOverview) return;
    function returnToOverview(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      const rack = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-rack-id]") : null;
      onOverview?.(rack?.dataset.rackId);
    }
    map.addEventListener("keydown", returnToOverview);
    return () => map.removeEventListener("keydown", returnToOverview);
  }, [showDetails, onOverview]);

  useEffect(() => {
    const frame = board.current?.parentElement?.parentElement;
    if (!frame || !onZoomGesture) return;
    function zoomFromWheel(event: WheelEvent) {
      if ((!event.ctrlKey && !event.metaKey) || !event.deltaY || event.defaultPrevented) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelZoom.current < 160) return;
      lastWheelZoom.current = now;
      onZoomGesture?.(event.deltaY < 0 ? 1 : -1, [event.clientX, event.clientY]);
    }
    function zoomFromKeyboard(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.defaultPrevented || !frame?.matches(":hover"))
        return;
      const key = event.key;
      if (key !== "+" && key !== "=" && key !== "-" && key !== "0") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      if (!event.repeat) onZoomGesture?.(key === "0" ? 0 : key === "-" ? -1 : 1);
    }
    frame.addEventListener("wheel", zoomFromWheel, { passive: false });
    window.addEventListener("keydown", zoomFromKeyboard);
    return () => {
      frame.removeEventListener("wheel", zoomFromWheel);
      window.removeEventListener("keydown", zoomFromKeyboard);
    };
  }, [onZoomGesture]);

  function startDrag(event: PointerEvent<HTMLElement>, placement: RackPlacement) {
    if (!onMove || event.button !== 0 || disabled || gesture.current || !board.current) return;
    const bounds = board.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    onSelect(placement.rackId);
    gesture.current = {
      pointer: event.pointerId,
      placement,
      x: event.clientX,
      y: event.clientY,
      unitX: bounds.width / columns,
      unitY: bounds.height / rows,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!dropTarget.current && Math.hypot(dx, dy) < 5) return;
    const candidate = {
      ...active.placement,
      column:
        active.placement.column + Math.round((dx / active.unitX) * rackLayoutGridDivisions) / rackLayoutGridDivisions,
      row: active.placement.row + Math.round((dy / active.unitY) * rackLayoutGridDivisions) / rackLayoutGridDivisions,
    };
    dropTarget.current = candidate;
    setDragTarget(candidate);
  }

  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointer !== event.pointerId) return;
    const candidate = dropTarget.current;
    gesture.current = null;
    dropTarget.current = null;
    setDragTarget(null);
    if (candidate && onMove && event.type === "pointerup") onMove(candidate);
  }

  if (!racks.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前房间尚未创建笼架" />;

  const draggedRack = dragTarget ? sizes.get(dragTarget.rackId) : undefined;
  const roomMap = (
    <div className="cage-room-map-scroll" aria-label="房间笼架布局" role="region" tabIndex={0} ref={regionRef}>
      <div
        className="cage-room-map"
        data-editable={Boolean(onMove)}
        data-details={showDetails}
        ref={board}
        style={
          {
            "--rack-map-columns": columns,
            "--rack-map-rows": rows,
            "--rack-map-zoom": zoom,
            "--rack-map-grid-divisions": rackLayoutGridDivisions,
            "--rack-detail-columns-per-unit": detailColumnsPerUnit,
            "--rack-detail-rows-per-unit": detailRowsPerUnit,
          } as CSSProperties
        }
      >
        {racks.map((rack) => {
          const placement = placementsByRack.get(rack.id);
          if (!placement) return null;
          const rackSlots = slotsByRack.get(rack.id) ?? [];
          const free = rackSlots.filter((slot) => slot.status === "empty").length;
          const label = `${rack.name}，${free} 个空位`;
          const grid = rackGrid(rack, placement.rotation);
          const position = placementStyle(placement, bounds, rack, grid);
          if (showDetails && onSelectSlot) {
            return (
              <section
                className="cage-room-rack cage-room-rack-detail"
                aria-label={rack.name}
                data-rack-id={rack.id}
                data-rotation={placement.rotation}
                data-selected={selectedRackId === rack.id}
                key={rack.id}
                style={position}
              >
                <Button
                  className="cage-room-rack-detail-heading"
                  type="text"
                  size="small"
                  aria-label={label}
                  aria-pressed={selectedRackId === rack.id}
                  title={rack.name}
                  onClick={(event) => onSelect(rack.id, event.currentTarget)}
                >
                  {rack.name}
                </Button>
                <div className="cage-room-rack-preview">
                  {rackSlots.map((slot) => {
                    const occupancy = occupancyBySlot.get(slot.id) ?? null;
                    const { column, row } = grid.position(slot);
                    return (
                      <CageSlotButton
                        key={slot.id}
                        slot={slot}
                        rack={rack}
                        roomName={roomName}
                        roomSpecies={roomSpecies}
                        occupancy={occupancy}
                        strain={occupancy ? occupancyStrains?.[occupancy.id] : undefined}
                        projectFill={projectColors.get(cageProjectKey(occupancy?.iacuc))}
                        selected={Boolean(selectedSlotIds?.has(slot.id))}
                        gridColumn={column}
                        gridRow={row}
                        today={today}
                        onSelect={onSelectSlot}
                      />
                    );
                  })}
                </div>
              </section>
            );
          }
          return (
            <Button
              className="cage-room-rack"
              data-rack-id={rack.id}
              data-editable={Boolean(onMove)}
              data-rotation={placement.rotation}
              key={rack.id}
              aria-label={label}
              aria-pressed={selectedRackId === rack.id}
              disabled={disabled}
              style={position}
              onClick={(event) => onSelect(rack.id, event.currentTarget)}
              onPointerDown={(event) => startDrag(event, placement)}
              onPointerMove={updateDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={finishDrag}
              onKeyDown={(event) => {
                if (!onMove) return;
                const steps: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                };
                const step = steps[event.key];
                if (!step) return;
                event.preventDefault();
                onSelect(rack.id);
                onMove({
                  ...placement,
                  column: placement.column + step[0] / rackLayoutGridDivisions,
                  row: placement.row + step[1] / rackLayoutGridDivisions,
                });
              }}
            >
              <span className="cage-room-rack-name">
                <Typography.Text ellipsis={{ tooltip: rack.name }} strong>
                  {rack.name}
                </Typography.Text>
              </span>
              <span className="cage-room-rack-preview" aria-hidden="true">
                {rackSlots.map((slot) => {
                  const occupancy = occupancyBySlot.get(slot.id) ?? null;
                  const iacuc = cageProjectKey(occupancy?.iacuc);
                  const people = showSummary && occupancy && cageOccupancyPeople(occupancy);
                  const storedStrain = occupancy && occupancyStrains?.[occupancy.id];
                  const strain = typeof storedStrain === "string" ? storedStrain : "";
                  const animal =
                    showSummary && occupancy && (strain || speciesLabel(cageSpecies(occupancy.species, roomSpecies)));
                  const count = occupancy?.animalCount;
                  const { column, row } = grid.position(slot);
                  return (
                    <span
                      className="cage-room-slot"
                      key={slot.id}
                      data-cage-status={cageDisplayStatus(slot, occupancy, today)}
                      style={
                        {
                          gridArea: `${row} / ${column}`,
                          "--cage-project-fill": projectColors.get(iacuc),
                        } as CSSProperties
                      }
                    >
                      {showSummary ? (
                        <span className="cage-room-slot-summary">
                          <strong className="cage-room-slot-header">{slotPosition(slot)}</strong>
                          {iacuc || (people && people.names) ? (
                            <span className="cage-room-slot-record">
                              {iacuc ? (
                                <strong className="cage-room-slot-iacuc" title={iacuc}>
                                  {iacuc}
                                </strong>
                              ) : null}
                              {people && people.names ? (
                                <span className="cage-room-slot-people" title={people.description}>
                                  {people.names}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          {animal || count != null ? (
                            <span className="cage-room-slot-animals">
                              {animal ? (
                                <span
                                  className="cage-room-slot-animal"
                                  title={`${strain ? "动物品系" : "动物种类"} ${animal}`}
                                >
                                  {animal}
                                </span>
                              ) : null}
                              {count != null ? (
                                <span className="cage-room-slot-count" title={`${count} 只`}>
                                  {count} 只
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </span>
            </Button>
          );
        })}
        {dragTarget && draggedRack ? (
          <span
            className="cage-room-rack cage-room-rack-drop"
            aria-hidden="true"
            data-editable="true"
            data-blocked={!rackPlacementFits(dragTarget, placements, sizes)}
            style={placementStyle(dragTarget, bounds, draggedRack)}
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {controls ? (
        <div className="cage-room-map-frame">
          {roomMap}
          {controls}
        </div>
      ) : (
        roomMap
      )}
      {racks.some((rack) => !placementsByRack.has(rack.id)) ? (
        <Flex align="center" gap={8} wrap>
          <Typography.Text type="secondary">未布置笼架</Typography.Text>
          {racks
            .filter((rack) => !placementsByRack.has(rack.id))
            .map((rack) => (
              <Button key={rack.id} size="small" onClick={(event) => onSelect(rack.id, event.currentTarget)}>
                {rack.name}
              </Button>
            ))}
        </Flex>
      ) : null}
    </>
  );
}

export function RoomRackLegend() {
  return (
    <Flex gap={12} wrap>
      {Object.entries(cageStatusLabels).map(([status, label]) => (
        <span className="cage-map-key" key={status}>
          <i data-cage-status={status} aria-hidden="true" />
          {label}
        </span>
      ))}
    </Flex>
  );
}
