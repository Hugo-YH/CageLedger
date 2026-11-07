import { useMemo, useState } from "react";
import { Alert, Input } from "antd";
import type { CageRack, CageSlot, Occupancy } from "../../../api/contracts";
import { ModalShell } from "../../../components/WorkspaceUi";
import { ActionButton } from "../../../components/ui";
import { cageCode, currentOccupancyIndex, emptyOccupancy, slotPosition } from "../../../../domain/cages";
import { Field, SlotStatusSelect } from "./CageFormControls";
import { today } from "./cageWorkspaceDate";
import { useBatchSlotOperation, type BatchSlotWrite } from "./useBatchSlotOperation";

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
  const occupancyBySlot = useMemo(() => currentOccupancyIndex(occupancies), [occupancies]);
  const [draft, setDraft] = useState<
    Pick<Occupancy, "status" | "iacuc" | "project" | "pi" | "owner" | "startDate" | "endDate" | "notes">
  >(() => {
    const first = slots.map((slot) => occupancyBySlot.get(slot.id)).find(Boolean);
    return {
      status: first?.status === "reserved" ? "reserved" : "active",
      iacuc: first?.iacuc || "",
      project: first?.project || "",
      pi: first?.pi || "",
      owner: first?.owner || "",
      startDate: first?.startDate || today,
      endDate: first?.endDate || "",
      notes: first?.notes || "",
    };
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const operation = useBatchSlotOperation(roomId, beginOperation, onDone);
  const frozen = operation.busy || Boolean(operation.job);
  const update = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  function prepare(kind: "save" | "clear"): BatchSlotWrite[] {
    return slots.map<BatchSlotWrite>((slot) => {
      const current = occupancyBySlot.get(slot.id);
      if (kind === "clear")
        return current ? { item: { ...current, status: "ended", endDate: today }, exists: true } : null;
      return {
        item: {
          ...(current || emptyOccupancy(slot.id, cageCode(slot, rack.index, roomName), today)),
          ...draft,
          slotId: slot.id,
        },
        exists: Boolean(current),
      };
    });
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
        {operation.error ? (
          <Alert
            showIcon
            type="error"
            title={operation.error}
            description="本次修改已固定；继续操作只处理尚未完成的笼位。版本冲突请关闭后核对最新记录。"
          />
        ) : null}
        <div className="compact-form-row third">
          <SlotStatusSelect
            disabled={frozen}
            id="cage-batch-status"
            value={draft.status}
            onChange={(value) => update("status", value)}
          />
          <Field
            disabled={frozen}
            label="IACUC 编号"
            value={draft.iacuc}
            onChange={(value) => update("iacuc", value)}
          />
          <Field
            disabled={frozen}
            label="项目名称"
            value={draft.project}
            onChange={(value) => update("project", value)}
          />
        </div>
        <div className="compact-form-row half">
          <Field
            disabled={frozen}
            personNames
            label="项目负责人"
            value={draft.pi}
            onChange={(value) => update("pi", value)}
          />
          <Field
            disabled={frozen}
            personNames
            label="实验负责人"
            value={draft.owner}
            onChange={(value) => update("owner", value)}
          />
        </div>
        <div className="compact-form-row half">
          <Field
            disabled={frozen}
            label="开始日期"
            type="date"
            value={draft.startDate}
            onChange={(value) => update("startDate", value)}
          />
          <Field
            disabled={frozen}
            label="结束日期"
            type="date"
            value={draft.endDate}
            onChange={(value) => update("endDate", value)}
          />
        </div>
        <label htmlFor="cage-batch-notes">
          备注
          <Input.TextArea
            aria-label="备注"
            id="cage-batch-notes"
            rows={3}
            disabled={frozen}
            value={draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
        </label>
      </div>
      <div className="modal-shell-actions">
        <ActionButton
          tone="destructive"
          disabled={operation.busy || operation.job?.kind === "save"}
          loading={operation.busy && operation.job?.kind === "clear"}
          onClick={() =>
            operation.job?.kind === "clear" || confirmClear
              ? void operation.run("clear", () => prepare("clear"))
              : setConfirmClear(true)
          }
        >
          {operation.job?.kind === "clear" ? "继续批量设空" : confirmClear ? "再次点击确认批量设空" : "批量设为空"}
        </ActionButton>
        <ActionButton
          disabled={operation.busy || operation.job?.kind === "clear"}
          loading={operation.busy && operation.job?.kind === "save"}
          tone="primary"
          onClick={() => void operation.run("save", () => prepare("save"))}
        >
          {operation.job?.kind === "save" ? "继续批量保存" : "批量保存"}
        </ActionButton>
      </div>
    </ModalShell>
  );
}
