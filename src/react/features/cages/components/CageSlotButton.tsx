import { memo, type CSSProperties } from "react";
import {
  animalAgeText,
  animalSexLabel,
  cageCode,
  cageDisplayStatus,
  cageStatusLabels,
  slotPosition,
} from "../../../../domain/cages";
import { speciesLabel } from "../../../../domain/intake";
import { formatPersonNames } from "../../../../domain/personNames";
import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";

export const CageSlotButton = memo(function CageSlotButton({
  slot,
  rack,
  roomName,
  roomSpecies,
  occupancy,
  projectFill,
  selected,
  today,
  onSelect,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  occupancy: Occupancy | null;
  projectFill?: string;
  selected: boolean;
  today: string;
  onSelect: (slot: CageSlot) => void;
}) {
  const code = cageCode(slot, rack.index, roomName);
  const status = cageDisplayStatus(slot, occupancy, today);
  const label = cageStatusLabels[status];
  const iacuc = occupancy?.iacuc || "未填写 IACUC";
  const owner = occupancy && (formatPersonNames(occupancy.owner) || "未填写");
  const species = occupancy?.species || roomSpecies;
  const animalSummary = occupancy
    ? [speciesLabel(species), occupancy.animalCount == null ? "数量未填写" : `${occupancy.animalCount} 只`]
        .filter(Boolean)
        .join(" · ")
    : "";
  const monkeySummary =
    occupancy && species === "monkey"
      ? `${animalSexLabel(occupancy.animalSex)} · ${animalAgeText(occupancy.birthDate, today) || "年龄未填写"}`
      : "";
  const accessibleLabel = occupancy
    ? [code, label, iacuc, `实验负责人 ${owner}`, animalSummary, monkeySummary]
    : [code, label];
  return (
    <button
      className={`slot${selected ? " selected" : ""}`}
      type="button"
      aria-label={accessibleLabel.filter(Boolean).join("，")}
      aria-pressed={selected}
      data-cage-status={status}
      style={{ gridColumn: slot.col, "--cage-project-fill": projectFill } as CSSProperties}
      onClick={() => onSelect(slot)}
    >
      <span className="slot-header">
        <span className="slot-code" title={code}>
          {slotPosition(slot)}
        </span>
        <span className="slot-state">{label}</span>
      </span>
      {occupancy ? (
        <>
          <strong className="slot-iacuc" title={iacuc}>
            {iacuc}
          </strong>
          <span className="slot-person" title={`实验负责人 ${owner}`}>
            实验负责人 {owner}
          </span>
          <span className="slot-animal-meta" title={animalSummary}>
            {animalSummary}
          </span>
          {monkeySummary ? <span className="slot-animal-meta">{monkeySummary}</span> : null}
        </>
      ) : null}
    </button>
  );
});
