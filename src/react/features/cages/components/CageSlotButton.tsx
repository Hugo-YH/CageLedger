import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";
import { animalAgeText, animalSexLabel, cageCode, occupancyPeriodTone, slotPosition } from "../../../../domain/cages";

export function CageSlotButton({
  slot,
  rack,
  roomName,
  roomSpecies,
  occupancy,
  selected,
  today,
  onClick,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  occupancy: Occupancy | null;
  selected: boolean;
  today: string;
  onClick: () => void;
}) {
  const tone = occupancyPeriodTone(occupancy, today);
  const monkeySummary =
    occupancy && roomSpecies === "monkey"
      ? `${animalSexLabel(occupancy.animalSex)} · ${animalAgeText(occupancy.birthDate, today) || "年龄未填写"}`
      : "";
  return (
    <button
      className={`slot ${slot.status} ${tone ? `period-${tone}` : ""} ${selected ? "selected" : ""}`}
      type="button"
      aria-label={`${cageCode(slot, rack.index, roomName)} ${occupancy?.iacuc || "空"}${monkeySummary ? ` ${monkeySummary}` : ""}`}
      onClick={onClick}
    >
      <span className="slot-code">{cageCode(slot, rack.index, roomName)}</span>
      {occupancy ? (
        <>
          <strong className="slot-iacuc">{occupancy.iacuc || "未填写 IACUC"}</strong>
          <span className="slot-person">
            {occupancy.pi || "未填写PI"} / {occupancy.owner || "未填写负责人"}
          </span>
          <span className="slot-date">{occupancy.startDate || "未设置入住时间"}</span>
          {monkeySummary ? <span className="slot-animal-meta">{monkeySummary}</span> : null}
        </>
      ) : (
        <strong className="slot-empty-text">空</strong>
      )}
      <span className="slot-position">{slotPosition(slot)}</span>
    </button>
  );
}
