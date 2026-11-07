import { ActionButton, ModalPresence } from "../../../components/ui";
import { ModalShell } from "../../../components/WorkspaceUi";
import type { useIntakeBatchActions } from "../hooks/useIntakeBatchActions";
import type { useIntakePrintActions } from "../hooks/useIntakePrintActions";
import type { useIntakeRecognitionMerge } from "../hooks/useIntakeRecognitionMerge";
import type { useIntakeSaveFlow } from "../hooks/useIntakeSaveFlow";
import { IntakeDuplicateConfirmDialog } from "./IntakeDuplicateConfirmDialog";
import { IntakePrintConfirmDialog } from "./IntakePrintConfirmDialog";
import { IntakeReceiptConfirmDialog } from "./IntakeReceiptConfirmDialog";
import { IntakeReviewDialog } from "./IntakeReviewDialog";

export function IntakeActionDialogs({
  actions,
  printer,
  saves,
  merge,
}: {
  actions: ReturnType<typeof useIntakeBatchActions>;
  printer: ReturnType<typeof useIntakePrintActions>;
  saves: ReturnType<typeof useIntakeSaveFlow>;
  merge: ReturnType<typeof useIntakeRecognitionMerge>;
}) {
  const receipt = actions.pendingReceipt;
  const print = printer.pendingPrint;
  const duplicate = saves.pendingDuplicate;
  const preview = merge.state?.result;
  return (
    <>
      <ModalPresence>
        {actions.deleteTarget ? (
          <ModalShell
            key={actions.deleteTarget.id}
            ariaLabel="删除待接收批次"
            onClose={() => actions.setDeleteTarget(null)}
          >
            <div className="modal-shell-head">
              <div>
                <h2 id="delete-intake-title">删除待接收批次</h2>
                <p>{actions.deleteTarget.batchNo}</p>
              </div>
            </div>
            <div className="modal-shell-body">
              <p>删除后，该批次及关联的待进驻任务会一并移除。</p>
            </div>
            <div className="modal-shell-actions">
              <ActionButton onClick={() => actions.setDeleteTarget(null)}>取消</ActionButton>
              <ActionButton
                disabled={actions.remove.isPending}
                loading={actions.remove.isPending}
                tone="destructive"
                onClick={actions.confirmDelete}
              >
                确认删除
              </ActionButton>
            </div>
          </ModalShell>
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {receipt ? (
          <IntakeReceiptConfirmDialog
            key={receipt.items.map((item) => item.id).join(",")}
            items={receipt.items}
            pending={actions.markingReceived}
            error={actions.receiptError}
            blocked={actions.receiptNeedsReselect}
            onClose={actions.closeReceipt}
            onConfirm={actions.receive}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {print ? (
          <IntakePrintConfirmDialog
            key={print.batches.map((batch) => batch.id).join(",")}
            job={print}
            onClose={printer.close}
            onPrint={(fillBlanks) => void printer.executePrint(print, fillBlanks)}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {preview && (preview.total > 0 || preview.outcome !== "unmatched" || preview.sourceIssues.length > 0) ? (
          <IntakeReviewDialog
            key={preview.items.map((candidate) => candidate.item.id).join(",")}
            preview={preview}
            incoming={merge.state!.incoming}
            images={merge.state!.images}
            pending={merge.state!.saving || saves.mutation.isPending}
            error={merge.state!.saveError}
            blocked={merge.state!.needsRefresh}
            onClose={merge.close}
            onConfirm={(id) => void merge.confirm(id)}
            onRefresh={merge.retry}
            onAcknowledge={merge.acknowledge}
            onEdit={merge.edit}
            canCreateAnother={Boolean(duplicate)}
            onCreateAnother={() => void saves.confirmDuplicate()}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {duplicate && !duplicate.details.review ? (
          <IntakeDuplicateConfirmDialog
            key={duplicate.details.confirmationToken}
            details={duplicate.details}
            error={duplicate.error}
            pending={saves.mutation.isPending}
            onClose={saves.dismissDuplicate}
            onConfirm={() => void saves.confirmDuplicate()}
          />
        ) : null}
      </ModalPresence>
    </>
  );
}
