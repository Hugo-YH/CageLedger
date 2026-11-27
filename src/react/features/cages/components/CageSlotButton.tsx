import { memo, type CSSProperties } from "react";
import {
  cageCode,
  cageDisplayStatus,
  cageOccupancyDetails,
  cageStatusLabels,
  slotPosition,
} from "../../../../domain/cages";
import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";

export const CageSlotButton = memo(function CageSlotButton({
  slot,
  rack,
  roomName,
  roomSpecies,
  occupancy,
  strain,
  projectFill,
  gridColumn = slot.col,
  gridRow,
  selected,
  today,
  onSelect,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  occupancy: Occupancy | null;
  strain?: string;
  projectFill?: string;
  gridColumn?: number;
  gridRow?: number;
  selected: boolean;
  today: string;
  onSelect: (slot: CageSlot) => void;
}) {
  const code = cageCode(slot, rack.index, roomName);
  const status = cageDisplayStatus(slot, occupancy, today);
  const label = cageStatusLabels[status];
  const details = cageOccupancyDetails(occupancy, roomSpecies, today, strain);
  const accessibleLabel = details
    ? [
        code,
        label,
        details.iacuc,
        details.people.description,
        details.animalSummary,
        details.strain,
        details.monkeySummary,
      ]
    : [code, label];
  return (
    <button
      className={`slot${selected ? " selected" : ""}`}
      type="button"
      aria-label={accessibleLabel.filter(Boolean).join("，")}
      aria-pressed={selected}
      data-cage-status={status}
      style={{ gridColumn, gridRow, "--cage-project-fill": projectFill } as CSSProperties}
      onClick={() => onSelect(slot)}
    >
      <CageSlotContent
        code={code}
        position={slotPosition(slot)}
        label={label}
        showStatusDot={status === "open"}
        details={details}
      />
    </button>
  );
});

function CageSlotContent({
  code,
  position,
  label,
  showStatusDot,
  details,
}: {
  code: string;
  position: string;
  label: string;
  showStatusDot: boolean;
  details: ReturnType<typeof cageOccupancyDetails>;
}) {
  return (
    <span className="slot-card-content">
      <span className="slot-header">
        <span className="slot-code" title={code}>
          {position}
        </span>
        {showStatusDot ? (
          <span className="slot-state-dot" title={label} aria-hidden="true" />
        ) : (
          <span className="slot-state" title={label}>
            {label}
          </span>
        )}
      </span>
      {details ? (
        <>
          <span className="slot-record">
            <strong className="slot-iacuc" title={details.iacuc}>
              {details.iacuc}
            </strong>
            {details.people.names ? (
              <span className="slot-person" title={details.people.description}>
                {details.people.names}
              </span>
            ) : null}
          </span>
          <span className="slot-animals">
            <span className="slot-animal-main" title={details.animalSummary}>
              <span className="slot-animal-type">{details.animal}</span>
              {details.count ? <span className="slot-animal-count">{details.count}</span> : null}
            </span>
            {details.strain ? (
              <span className="slot-animal-meta" title={`品系 ${details.strain}`}>
                {details.strain}
              </span>
            ) : null}
            {details.monkeySummary ? <span className="slot-animal-meta">{details.monkeySummary}</span> : null}
          </span>
        </>
      ) : null}
    </span>
  );
}
