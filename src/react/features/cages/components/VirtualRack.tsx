import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";
import { CageSlotButton } from "./CageSlotButton";
import { today } from "./cageWorkspaceDate";

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
  const { rows, slotsByRow } = useMemo(() => {
    const nextSlotsByRow = new Map<number, CageSlot[]>();
    for (const slot of slots) {
      const rowSlots = nextSlotsByRow.get(slot.row);
      if (rowSlots) rowSlots.push(slot);
      else nextSlotsByRow.set(slot.row, [slot]);
    }
    const nextRows = [...nextSlotsByRow.keys()].sort((a, b) => a - b);
    for (const rowSlots of nextSlotsByRow.values()) rowSlots.sort((a, b) => a.col - b.col);
    return { rows: nextRows, slotsByRow: nextSlotsByRow };
  }, [slots]);
  const occupancyBySlotId = useMemo(
    () =>
      new Map(
        occupancies
          .filter((item) => item.status === "active" || item.status === "reserved")
          .map((item) => [item.slotId, item]),
      ),
    [occupancies],
  );
  const selectedSlotIdSet = useMemo(() => new Set(selectedSlotIds), [selectedSlotIds]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (roomSpecies === "monkey" ? 144 : 128),
    overscan: 3,
  });
  return (
    <div className="react-rack-scroll" ref={scrollRef}>
      <div className="react-rack-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          const rowSlots = slotsByRow.get(row) || [];
          return (
            <div
              className={`react-rack-row ${roomSpecies === "monkey" ? "monkey-rack-row" : ""}`}
              key={row}
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${rack.cols}, var(--cage-slot-size, 120px))`,
              }}
            >
              {rowSlots.map((slot) => (
                <CageSlotButton
                  key={slot.id}
                  slot={slot}
                  rack={rack}
                  roomName={roomName}
                  roomSpecies={roomSpecies}
                  occupancy={occupancyBySlotId.get(slot.id) || null}
                  selected={slot.id === selectedSlotId || selectedSlotIdSet.has(slot.id)}
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
