import { useState } from "react";
import { Input } from "antd";
import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";
import { useSaveOccupancy } from "../../../api/cages";
import { ModalShell } from "../../../components/WorkspaceUi";
import { ActionButton } from "../../../components/ui";
import { animalAgeText, cageCode, emptyOccupancy } from "../../../../domain/cages";
import { Field, SexSelect, SlotStatusSelect } from "./CageFormControls";
import { today } from "./cageWorkspaceDate";

export function SlotEditor({
  slot,
  rack,
  roomName,
  roomSpecies,
  occupancy,
  roomId,
  onClose,
  onNotice,
  beginOperation,
}: {
  slot: CageSlot;
  rack: CageRack;
  roomName: string;
  roomSpecies: string;
  occupancy: Occupancy | null;
  roomId: string;
  onClose: () => void;
  onNotice: (message: string) => void;
  beginOperation: () => () => boolean;
}) {
  const [draft, setDraft] = useState(
    () => occupancy || emptyOccupancy(slot.id, cageCode(slot, rack.index, roomName), today),
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const showMonkeyFields = roomSpecies === "monkey";
  const ageText = animalAgeText(draft.birthDate, today);
  const save = useSaveOccupancy(roomId);
  const update = (key: keyof Occupancy, value: string | number | null) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const isCurrent = beginOperation();
    try {
      await save.mutateAsync({ item: { ...draft, slotId: slot.id }, exists: Boolean(occupancy) });
      if (!isCurrent()) return;
      onNotice(`笼位 ${cageCode(slot, rack.index, roomName)} 已保存。`);
      onClose();
    } catch (error) {
      if (isCurrent()) onNotice(error instanceof Error ? error.message : "保存失败");
    }
  }
  async function clear() {
    if (!occupancy) {
      onClose();
      return;
    }
    const isCurrent = beginOperation();
    await save.mutateAsync({
      item: { ...occupancy, status: "ended", endDate: today },
      exists: true,
    });
    if (!isCurrent()) return;
    onNotice(`笼位 ${cageCode(slot, rack.index, roomName)} 已设为空。`);
    onClose();
  }
  return (
    <ModalShell
      ariaLabel={`编辑笼位 ${cageCode(slot, rack.index, roomName)}`}
      className="cage-slot-modal"
      width={640}
      onClose={onClose}
    >
      <div className="modal-shell-head">
        <div>
          <h2 id="slot-editor-title">编辑笼位 {cageCode(slot, rack.index, roomName)}</h2>
          <p>{occupancy ? "维护当前占用记录" : "录入新的占用记录"}</p>
        </div>
        <ActionButton aria-label="关闭" onClick={onClose}>
          关闭
        </ActionButton>
      </div>
      <form className="modal-shell-body form compact-slot-form" onSubmit={submit}>
        <div className="compact-form-row third">
          <SlotStatusSelect id="cage-slot-status" value={draft.status} onChange={(value) => update("status", value)} />
          <Field label="笼位编号" value={draft.cageCode} onChange={(value) => update("cageCode", value)} />
          <Field
            label="动物数量"
            type="number"
            value={draft.animalCount || ""}
            onChange={(value) => update("animalCount", value ? Number(value) : null)}
          />
        </div>
        {showMonkeyFields ? (
          <fieldset className="monkey-detail-fields">
            <legend>猴个体信息</legend>
            <div className="compact-form-row third">
              <SexSelect
                id="cage-slot-sex"
                value={draft.animalSex || "unknown"}
                onChange={(value) => update("animalSex", value)}
              />
              <Field
                label="出生日期"
                type="date"
                value={draft.birthDate || ""}
                max={today}
                onChange={(value) => update("birthDate", value)}
              />
              <div className="monkey-age-field">
                <label htmlFor="monkey-age">年龄</label>
                <Input
                  id="monkey-age"
                  type="text"
                  value={ageText || "自动计算"}
                  readOnly
                  aria-describedby="monkey-age-help"
                />
                <small id="monkey-age-help">根据出生日期自动计算</small>
              </div>
            </div>
          </fieldset>
        ) : null}
        <div className="compact-form-row half">
          <Field label="IACUC 编号" value={draft.iacuc} onChange={(value) => update("iacuc", value)} />
          <Field label="项目名称" value={draft.project} onChange={(value) => update("project", value)} />
        </div>
        <div className="compact-form-row half">
          <Field personNames label="项目负责人" value={draft.pi} onChange={(value) => update("pi", value)} />
          <Field personNames label="实验负责人" value={draft.owner} onChange={(value) => update("owner", value)} />
        </div>
        <div className="compact-form-row third">
          <Field
            label="开始日期"
            type="date"
            value={draft.startDate}
            onChange={(value) => update("startDate", value)}
          />
          <Field
            label="饲养周期（天）"
            type="number"
            value={draft.feedingDays || ""}
            onChange={(value) => update("feedingDays", value ? Number(value) : null)}
          />
          <Field label="结束日期" type="date" value={draft.endDate} onChange={(value) => update("endDate", value)} />
        </div>
        <label htmlFor="cage-slot-notes">
          备注
          <Input.TextArea
            aria-label="备注"
            id="cage-slot-notes"
            rows={3}
            value={draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
        </label>
        <div className="modal-shell-actions">
          <ActionButton tone="destructive" onClick={() => (confirmClear ? void clear() : setConfirmClear(true))}>
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
