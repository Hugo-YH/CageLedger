import { ActionIcon } from "../../../components/ui/ActionIcon";
import { ActionButton } from "../../../components/ui";
import { ModalShell } from "../../../components/WorkspaceUi";
import type { PendingIntakePrintJob } from "../intakeViewTypes";

export function IntakePrintConfirmDialog({
  job,
  onClose,
  onPrint,
}: {
  job: PendingIntakePrintJob;
  onClose: () => void;
  onPrint: (fillBlanks: boolean) => void;
}) {
  return (
    <ModalShell ariaLabel="补齐空白笼卡" className="intake-print-confirm-modal" onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2>补齐空白笼卡</h2>
          <p>{job.kind === "temporary" ? "8014 临时饲养间版式" : "普通饲养间版式"}</p>
        </div>
        <ActionButton aria-label="关闭" onClick={onClose}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body">
        <p>
          当前共 {job.cardCount} 张笼卡，距离整页 {job.pageSize} 张还差 {job.missing} 张。是否自动补齐空白卡？
        </p>
      </div>
      <div className="modal-shell-actions">
        <ActionButton icon={<ActionIcon name="print" />} onClick={() => onPrint(false)}>
          直接打印
        </ActionButton>
        <ActionButton icon={<ActionIcon name="print" />} tone="primary" onClick={() => onPrint(true)}>
          补空白卡并打印
        </ActionButton>
      </div>
    </ModalShell>
  );
}
