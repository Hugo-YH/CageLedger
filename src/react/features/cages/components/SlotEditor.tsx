import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import { useRef, useState } from "react";
import { Alert, Input, Select } from "antd";
import type { CageRack, CageSlot, Occupancy, OccupancyIntakeDetails } from "../../../api/contracts";
import { useSaveOccupancy } from "../../../api/cages";
import { ModalShell } from "../../../components/WorkspaceUi";
import { ActionButton, ReadOnlyInput } from "../../../components/ui";
import { animalAgeText, cageCode, cageSpecies, emptyOccupancy } from "../../../../domain/cages";
import { animalSpeciesOptions, normalizeIntakeSex } from "../../../../domain/intake";
import { Field, SexSelect, SlotStatusSelect } from "./CageFormControls";
import { useUnsavedChanges } from "../../../hooks/useUnsavedChanges";
import { today } from "./cageWorkspaceDate";

export function SlotEditor({
  slot,
  rack,
  roomName,
  roomSpecies,
  occupancy,
  strain,
  intakeDetails,
  roomId,
  onClose,
  beginOperation,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  occupancy: Occupancy | null;
  strain?: string;
  intakeDetails?: OccupancyIntakeDetails;
  roomId: string;
  onClose: () => void;
  beginOperation: () => () => boolean;
}) {
  const feedback = useOperationFeedback();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(
    () => occupancy || emptyOccupancy(slot.id, cageCode(slot, rack.index, roomName), today),
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const species = cageSpecies(draft.species, roomSpecies);
  const showMonkeyFields = species === "monkey";
  const intakeSex = normalizeIntakeSex(intakeDetails?.sex);
  const animalSex = draft.animalSex || (intakeSex === "雌性" ? "female" : intakeSex === "雄性" ? "male" : "unknown");
  const ageText = animalAgeText(draft.birthDate, today);
  const save = useSaveOccupancy(roomId);
  const [original] = useState(() => JSON.stringify(draft));
  const writing = useRef(false);
  const confirmLeave = useUnsavedChanges(JSON.stringify(draft) !== original, save.isPending);
  const close = () => {
    if (writing.current) return;
    void confirmLeave().then((leave) => {
      if (leave && !writing.current) onClose();
    });
  };
  const update = (key: keyof Occupancy, value: string | number | null) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const sexSelect = (
    <SexSelect
      disabled={save.isPending}
      id="cage-slot-sex"
      value={animalSex}
      onChange={(value) => update("animalSex", value)}
    />
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (writing.current) return;
    writing.current = true;
    const isCurrent = beginOperation();
    setError("");
    try {
      await save.mutateAsync({ item: { ...draft, slotId: slot.id }, exists: Boolean(occupancy) });
      if (!isCurrent()) return;
      feedback.success("笼位已保存", cageCode(slot, rack.index, roomName));
      onClose();
    } catch (error) {
      if (isCurrent()) setError(error instanceof Error ? error.message : "保存失败");
    } finally {
      writing.current = false;
    }
  }
  async function clear() {
    if (writing.current) return;
    if (!occupancy) {
      onClose();
      return;
    }
    writing.current = true;
    const isCurrent = beginOperation();
    setError("");
    try {
      await save.mutateAsync({ item: { ...occupancy, status: "ended", endDate: today }, exists: true });
      if (!isCurrent()) return;
      feedback.success("笼位已设为空", cageCode(slot, rack.index, roomName));
      onClose();
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "设为空失败，请重试");
    } finally {
      writing.current = false;
    }
  }
  return (
    <ModalShell
      ariaLabel={`编辑笼位 ${cageCode(slot, rack.index, roomName)}`}
      className="cage-slot-modal"
      width={640}
      busy={save.isPending}
      onClose={close}
    >
      <div className="modal-shell-head">
        <div>
          <h2 id="slot-editor-title">编辑笼位 {cageCode(slot, rack.index, roomName)}</h2>
          <p>{occupancy ? "维护当前占用记录" : "录入新的占用记录"}</p>
        </div>
        <ActionButton aria-label="关闭" disabled={save.isPending} onClick={close}>
          关闭
        </ActionButton>
      </div>
      <form className="modal-shell-body form compact-slot-form" onSubmit={submit}>
        {error ? <Alert showIcon type="error" title={error} /> : null}
        <div className="compact-form-row third">
          <SlotStatusSelect
            disabled={save.isPending}
            id="cage-slot-status"
            value={draft.status}
            onChange={(value) => update("status", value)}
          />
          <Field
            disabled={save.isPending}
            label="笼位编号"
            value={draft.cageCode}
            onChange={(value) => update("cageCode", value)}
          />
          <Field
            disabled={save.isPending}
            label="动物数量"
            type="number"
            value={draft.animalCount ?? ""}
            onChange={(value) => update("animalCount", value ? Number(value) : null)}
          />
        </div>
        <div className={`compact-form-row ${showMonkeyFields ? "third" : "half"}`}>
          <label htmlFor="cage-slot-species">
            物种
            <Select
              aria-label="物种"
              id="cage-slot-species"
              disabled={save.isPending}
              options={animalSpeciesOptions}
              value={species || undefined}
              onChange={(value) => update("species", value)}
            />
          </label>
          {showMonkeyFields ? null : sexSelect}
          <Field
            disabled={save.isPending}
            label="品系"
            value={draft.strainStandard === null ? "" : draft.strainStandard || strain || ""}
            onChange={(value) => update("strainStandard", value ? value : null)}
          />
          <Field
            disabled={save.isPending}
            label="规格（体重/日龄）"
            value={draft.specification === null ? "" : draft.specification || intakeDetails?.specification || ""}
            onChange={(value) => update("specification", value ? value : null)}
          />
        </div>
        {showMonkeyFields ? (
          <fieldset className="monkey-detail-fields">
            <legend>猴个体信息</legend>
            <div className="compact-form-row third">
              {sexSelect}
              <Field
                disabled={save.isPending}
                label="出生日期"
                type="date"
                value={draft.birthDate || ""}
                max={today}
                onChange={(value) => update("birthDate", value)}
              />
              <div className="monkey-age-field">
                <label htmlFor="monkey-age">年龄</label>
                <ReadOnlyInput
                  id="monkey-age"
                  type="text"
                  value={ageText || "自动计算"}
                  title="根据出生日期自动计算，无需编辑；可选中复制"
                  aria-describedby="monkey-age-help"
                />
                <small id="monkey-age-help">根据出生日期自动计算</small>
              </div>
            </div>
          </fieldset>
        ) : null}
        <div className="compact-form-row half">
          <Field
            disabled={save.isPending}
            label="IACUC 编号"
            value={draft.iacuc}
            onChange={(value) => update("iacuc", value)}
          />
          <Field
            disabled={save.isPending}
            label="项目名称"
            value={draft.project}
            onChange={(value) => update("project", value)}
          />
        </div>
        <div className="compact-form-row half">
          <Field
            disabled={save.isPending}
            personNames
            label="项目负责人"
            value={draft.pi}
            onChange={(value) => update("pi", value)}
          />
          <Field
            disabled={save.isPending}
            personNames
            label="实验负责人"
            value={draft.owner}
            onChange={(value) => update("owner", value)}
          />
        </div>
        <div className="compact-form-row third">
          <Field
            disabled={save.isPending}
            label="开始日期"
            type="date"
            value={draft.startDate}
            onChange={(value) => update("startDate", value)}
          />
          <Field
            disabled={save.isPending}
            label="饲养周期（天）"
            type="number"
            value={draft.feedingDays || ""}
            onChange={(value) => update("feedingDays", value ? Number(value) : null)}
          />
          <Field
            disabled={save.isPending}
            label="结束日期"
            type="date"
            value={draft.endDate}
            onChange={(value) => update("endDate", value)}
          />
        </div>
        <label htmlFor="cage-slot-notes">
          备注
          <Input.TextArea
            disabled={save.isPending}
            aria-label="备注"
            id="cage-slot-notes"
            rows={3}
            value={draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
        </label>
        <div className="modal-shell-actions">
          <ActionButton
            disabled={save.isPending}
            tone="destructive"
            onClick={() => (confirmClear ? void clear() : setConfirmClear(true))}
          >
            {confirmClear ? "再次点击确认设为空" : "设为空"}
          </ActionButton>
          <ActionButton disabled={save.isPending} loading={save.isPending} tone="primary" type="submit">
            保存笼位
          </ActionButton>
        </div>
      </form>
    </ModalShell>
  );
}
