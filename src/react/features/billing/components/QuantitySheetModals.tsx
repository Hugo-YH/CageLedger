import type { CageRoom, QuantitySheet, QuantitySheetRow } from "../../../api/contracts";
import { ModalShell } from "../../../components/WorkspaceUi";
import { roomBillingProfile } from "../../../../domain/quantitySheets";

export function ConfirmSave({
  sheet,
  room,
  pending,
  onCancel,
  onConfirm,
}: {
  sheet: QuantitySheet;
  room?: CageRoom;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const filled = sheet.rows.filter(hasRowContent).length;
  const profile = roomBillingProfile(room);
  return (
    <ModalShell ariaLabel="确认保存数量统计表" className="quantity-save-confirm" onClose={onCancel}>
      <div className="modal-shell-head">
        <div>
          <span className="workspace-kicker">保存前核对</span>
          <h2>确认保存数量统计表</h2>
        </div>
      </div>
      <div className="modal-shell-body">
        <div className="quantity-confirm-profile">
          <div>
            <strong>{room?.name || "未选择房间"}</strong>
            <span>
              {profile.facilityLabel} · {profile.item} · {profile.customerLabel}
            </span>
          </div>
          <strong>
            ¥{profile.price.toFixed(2)} / {profile.unit === "animal_day" ? "只/天" : "笼/天"}
          </strong>
        </div>
        <dl className="quantity-confirm-grid">
          <div>
            <dt>月份</dt>
            <dd>{sheet.month}</dd>
          </div>
          <div>
            <dt>IACUC</dt>
            <dd>{sheet.iacuc}</dd>
          </div>
          <div>
            <dt>项目负责人</dt>
            <dd>{sheet.pi || "-"}</dd>
          </div>
          <div>
            <dt>有效明细</dt>
            <dd>{filled} 行</dd>
          </div>
          <div>
            <dt>减免方式</dt>
            <dd>
              {sheet.fullExemption
                ? "全额减免"
                : sheet.preferredFreeCages
                  ? `优先减免 ${sheet.preferredFreeCages} 笼/天`
                  : "自动分配"}
            </dd>
          </div>
          <div>
            <dt>梯度策略</dt>
            <dd>{sheet.tierCagePriority !== null ? "当前伦理优先承接" : "自动分配"}</dd>
          </div>
        </dl>
      </div>
      <div className="modal-shell-actions">
        <button className="secondary" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="primary" type="button" disabled={pending} onClick={onConfirm}>
          确认保存
        </button>
      </div>
    </ModalShell>
  );
}

function hasRowContent(row: QuantitySheetRow) {
  return Boolean(row.date || row.addedCount || row.removedCount || row.animalCount != null || row.cageCount != null);
}
