import { useState } from "react";
import { Input } from "antd";
import type { CageRack, CageSlot, CageSlotStatus, Occupancy } from "../../../api/contracts";
import { useSaveOccupancy } from "../../../api/cages";
import { ModalShell } from "../../../components/WorkspaceUi";
import { ActionButton } from "../../../components/ui";
import { cageCode, currentOccupancy, emptyOccupancy, slotPosition } from "../../../../domain/cages";
import { Field, SlotStatusSelect } from "./CageFormControls";
import { today } from "./cageWorkspaceDate";

export function BatchSlotEditor({
  slots,
  rack,
  roomName,
  occupancies,
  roomId,
  onClose,
  onDone,
  beginOperation,
}: {
  slots: CageSlot[];
  rack: CageRack;
  roomName: string;
  occupancies: Occupancy[];
  roomId: string;
  onClose: () => void;
  onDone: (message: string) => void;
  beginOperation: () => () => boolean;
}) {
  const first = slots.map((slot) => currentOccupancy(slot.id, occupancies)).find(Boolean);
  const [draft, setDraft] = useState({
    status: (first?.status === "reserved" ? "reserved" : "active") as CageSlotStatus,
    iacuc: first?.iacuc || "",
    project: first?.project || "",
    pi: first?.pi || "",
    owner: first?.owner || "",
    startDate: first?.startDate || today,
    endDate: first?.endDate || "",
    notes: first?.notes || "",
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const save = useSaveOccupancy(roomId);
  const update = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  async function saveAll() {
    const isCurrent = beginOperation();
    for (const slot of slots) {
      const current = currentOccupancy(slot.id, occupancies);
      const item = {
        ...(current || emptyOccupancy(slot.id, cageCode(slot, rack.index, roomName), today)),
        ...draft,
        slotId: slot.id,
        updatedAt: today,
      } as Occupancy;
      await save.mutateAsync({ item, exists: Boolean(current) });
    }
    if (isCurrent()) onDone(`已批量保存 ${slots.length} 个笼位。`);
  }
  async function clearAll() {
    const isCurrent = beginOperation();
    for (const slot of slots) {
      const current = currentOccupancy(slot.id, occupancies);
      if (current)
        await save.mutateAsync({
          item: { ...current, status: "ended", endDate: today, updatedAt: today },
          exists: true,
        });
    }
    if (isCurrent()) onDone(`已将 ${slots.length} 个笼位设为空。`);
  }
  return (
    <ModalShell ariaLabel={`批量编辑 ${slots.length} 个笼位`} className="cage-slot-modal" width={720} onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2 id="batch-slot-title">批量编辑 {slots.length} 个笼位</h2>
          <p>{slots.map(slotPosition).join("、")}</p>
        </div>
        <ActionButton aria-label="关闭" onClick={onClose}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body form compact-slot-form">
        <div className="compact-form-row third">
          <SlotStatusSelect id="cage-batch-status" value={draft.status} onChange={(value) => update("status", value)} />
          <Field label="IACUC 编号" value={draft.iacuc} onChange={(value) => update("iacuc", value)} />
          <Field label="项目名称" value={draft.project} onChange={(value) => update("project", value)} />
        </div>
        <div className="compact-form-row half">
          <Field label="项目负责人" value={draft.pi} onChange={(value) => update("pi", value)} />
          <Field label="实验负责人" value={draft.owner} onChange={(value) => update("owner", value)} />
        </div>
        <div className="compact-form-row half">
          <Field
            label="开始日期"
            type="date"
            value={draft.startDate}
            onChange={(value) => update("startDate", value)}
          />
          <Field label="结束日期" type="date" value={draft.endDate} onChange={(value) => update("endDate", value)} />
        </div>
        <label htmlFor="cage-batch-notes">
          备注
          <Input.TextArea
            aria-label="备注"
            id="cage-batch-notes"
            rows={3}
            value={draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
        </label>
      </div>
      <div className="modal-shell-actions">
        <ActionButton tone="destructive" onClick={() => (confirmClear ? void clearAll() : setConfirmClear(true))}>
          {confirmClear ? "再次点击确认批量设空" : "批量设为空"}
        </ActionButton>
        <ActionButton disabled={save.isPending} loading={save.isPending} tone="primary" onClick={() => void saveAll()}>
          批量保存
        </ActionButton>
      </div>
    </ModalShell>
  );
}
