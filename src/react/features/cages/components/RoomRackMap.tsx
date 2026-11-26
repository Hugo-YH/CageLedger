import { Button, Empty, Flex, Tag, Typography } from "antd";
import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { cageDisplayStatus, cageStatusLabels } from "../../../../domain/cages";
import { rackFootprint, rackLayoutSize, rackPlacementFits } from "../../../../domain/rackLayout";
import type { CageRack, CageSlot, Occupancy, RackPlacement } from "../../../api/contracts";
import { cageProjectKey, type RoomProjectColor } from "./roomProjectColors";

export interface RoomRackMapData {
  racks: readonly CageRack[];
  slots: readonly CageSlot[];
  occupancyBySlot: ReadonlyMap<string, Occupancy>;
  projectColors: ReadonlyMap<string, RoomProjectColor>;
  today: string;
}

function cageProjectFill(occupancy: Occupancy | null, colors: ReadonlyMap<string, RoomProjectColor>) {
  return occupancy ? colors.get(cageProjectKey(occupancy.iacuc))?.fill : undefined;
}

function placementStyle(placement: RackPlacement, columns: number, rows: number): CSSProperties {
  const footprint = rackFootprint(placement.rotation);
  return {
    insetInlineStart: `${(placement.column / columns) * 100}%`,
    insetBlockStart: `${(placement.row / rows) * 100}%`,
    inlineSize: `${(footprint.columns / columns) * 100}%`,
    blockSize: `${(footprint.rows / rows) * 100}%`,
  };
}

export function RoomRackMap({
  racks,
  slots,
  occupancyBySlot,
  projectColors,
  today,
  placements,
  selectedRackId,
  onSelect,
  onMove,
  disabled = false,
}: RoomRackMapData & {
  placements: readonly RackPlacement[];
  selectedRackId?: string;
  onSelect: (rackId: string, trigger?: HTMLElement) => void;
  onMove?: (placement: RackPlacement) => void;
  disabled?: boolean;
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
  const { columns, rows } = rackLayoutSize(placements);
  const placementsByRack = new Map(placements.map((placement) => [placement.rackId, placement]));
  const slotsByRack = useMemo(() => {
    const grouped = new Map<string, CageSlot[]>();
    for (const slot of slots) {
      const group = grouped.get(slot.rackId);
      if (group) group.push(slot);
      else grouped.set(slot.rackId, [slot]);
    }
    return grouped;
  }, [slots]);

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
      column: active.placement.column + Math.round(dx / active.unitX),
      row: active.placement.row + Math.round(dy / active.unitY),
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

  return (
    <>
      <div className="cage-room-map-scroll" aria-label="房间笼架布局" role="region" tabIndex={0}>
        <div
          className="cage-room-map"
          ref={board}
          style={{ "--rack-map-columns": columns, "--rack-map-rows": rows } as CSSProperties}
        >
          {racks.map((rack) => {
            const placement = placementsByRack.get(rack.id);
            if (!placement) return null;
            const rackSlots = slotsByRack.get(rack.id) ?? [];
            const free = rackSlots.filter((slot) => slot.status === "empty").length;
            return (
              <Button
                className="cage-room-rack"
                data-editable={Boolean(onMove)}
                data-rotation={placement.rotation}
                key={rack.id}
                aria-label={`${rack.name}，${free} 个空位`}
                aria-pressed={selectedRackId === rack.id}
                disabled={disabled}
                style={placementStyle(placement, columns, rows)}
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
                  onMove({ ...placement, column: placement.column + step[0], row: placement.row + step[1] });
                }}
              >
                <span className="cage-room-rack-name">
                  <Typography.Text ellipsis={{ tooltip: rack.name }} strong>
                    {rack.name}
                  </Typography.Text>
                  <Typography.Text type="secondary">{free} 空</Typography.Text>
                </span>
                <span
                  className="cage-room-rack-preview"
                  aria-hidden="true"
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, rack.cols)}, minmax(0, 1fr))` }}
                >
                  {rackSlots.map((slot) => {
                    const occupancy = occupancyBySlot.get(slot.id) ?? null;
                    return (
                      <i
                        key={slot.id}
                        data-cage-status={cageDisplayStatus(slot, occupancy, today)}
                        style={{ "--cage-project-fill": cageProjectFill(occupancy, projectColors) } as CSSProperties}
                      />
                    );
                  })}
                </span>
              </Button>
            );
          })}
          {dragTarget ? (
            <span
              className="cage-room-rack-drop"
              aria-hidden="true"
              data-blocked={!rackPlacementFits(dragTarget, placements)}
              style={placementStyle(dragTarget, columns, rows)}
            />
          ) : null}
        </div>
      </div>
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

export function RoomRackLegend({ colors }: { colors: ReadonlyMap<string, RoomProjectColor> }) {
  return (
    <Flex vertical gap={8}>
      <Flex gap={12} wrap>
        {Object.entries(cageStatusLabels).map(([status, label]) => (
          <span className="cage-map-key" key={status}>
            <i data-cage-status={status} aria-hidden="true" />
            {label}
          </span>
        ))}
      </Flex>
      {colors.size ? (
        <Flex gap={4} wrap className="cage-project-key" aria-label="IACUC 底色">
          <Typography.Text type="secondary">IACUC 底色</Typography.Text>
          {[...colors.values()].map(({ iacuc, principal, fill }) => (
            <Tag key={iacuc} className="cage-project-tag" style={{ background: fill }}>
              {iacuc}
              {principal ? ` · ${principal}` : ""}
            </Tag>
          ))}
        </Flex>
      ) : null}
    </Flex>
  );
}
