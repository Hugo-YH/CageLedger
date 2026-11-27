import { memo, useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";
import { CageSlotButton } from "./CageSlotButton";
import { cageProjectKey } from "./roomProjectColors";

export const VirtualRack = memo(function VirtualRack({
  rack,
  roomName,
  roomSpecies,
  slots,
  occupancyBySlot,
  occupancyStrains,
  projectColors,
  today,
  selectedSlotId,
  selectedSlotIds,
  onSelect,
}: {
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  slots: CageSlot[];
  occupancyBySlot: ReadonlyMap<string, Occupancy>;
  occupancyStrains?: Readonly<Record<string, string>>;
  projectColors: ReadonlyMap<string, string>;
  today: string;
  selectedSlotId: string;
  selectedSlotIds: string[];
  onSelect: (slot: CageSlot) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { rowCount, columnCount, slotsByRow } = useMemo(() => {
    const slotsByRow = new Map<number, CageSlot[]>();
    let rowCount = rack.rows;
    let columnCount = rack.cols;
    for (const slot of slots) {
      rowCount = Math.max(rowCount, slot.row);
      columnCount = Math.max(columnCount, slot.col);
      const rowSlots = slotsByRow.get(slot.row);
      if (rowSlots) rowSlots.push(slot);
      else slotsByRow.set(slot.row, [slot]);
    }
    for (const rowSlots of slotsByRow.values()) rowSlots.sort((a, b) => a.col - b.col);
    return { rowCount, columnCount, slotsByRow };
  }, [rack.rows, rack.cols, slots]);
  const selectedSlotIdSet = useMemo(() => new Set(selectedSlotIds), [selectedSlotIds]);
  const virtualizer = useVirtualizer({
    count: slots.length ? rowCount : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (roomSpecies === "monkey" ? 128 : 108),
    gap: 8,
    overscan: 3,
  });
  return (
    <div className="react-rack-scroll" ref={scrollRef}>
      <div
        className="react-rack-virtual"
        style={{ height: virtualizer.getTotalSize(), "--cage-rack-columns": Math.max(1, columnCount) } as CSSProperties}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowSlots = slotsByRow.get(virtualRow.index + 1) || [];
          return (
            <div
              className="react-rack-row"
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {rowSlots.map((slot) => {
                const occupancy = occupancyBySlot.get(slot.id) ?? null;
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
                    selected={slot.id === selectedSlotId || selectedSlotIdSet.has(slot.id)}
                    today={today}
                    onSelect={onSelect}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
