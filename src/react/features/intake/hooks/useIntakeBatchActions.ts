import { useState } from "react";
import type { IntakeBatchListItem } from "../../../api/contracts";
import type { IntakePrintBatch } from "../../../../contracts/intake";
import { ApiError } from "../../../api/client";
import { useConfirmIntakeBatchesReceipt, useDeleteIntakeBatch, useMarkIntakeBatchesPrinted } from "../../../api/intake";
import { canConfirmIntakeReceipt, isDirectSampling } from "../../../../domain/intake";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import type { useIntakeSelection } from "./useIntakeSelection";

export function useIntakeBatchActions(selection: ReturnType<typeof useIntakeSelection>, refresh: () => unknown) {
  const feedback = useOperationFeedback();
  const remove = useDeleteIntakeBatch();
  const markBatchesPrinted = useMarkIntakeBatchesPrinted();
  const confirmBatchesReceipt = useConfirmIntakeBatchesReceipt();
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkNoticeKind, setBulkNoticeKind] = useState<"success" | "error" | "info">("info");
  const [markingPrinted, setMarkingPrinted] = useState(false);
  const [markingReceived, setMarkingReceived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IntakeBatchListItem | null>(null);
  const [pendingReceipt, setPendingReceipt] = useState<{ items: IntakeBatchListItem[]; skipped: number } | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [receiptNeedsReselect, setReceiptNeedsReselect] = useState(false);
  function showBulkNotice(message: string, kind: "success" | "error" | "info" = "info") {
    setBulkNotice(message);
    setBulkNoticeKind(kind);
  }
  async function markPrinted(targets: Pick<IntakePrintBatch, "id" | "intakePurpose" | "status">[]) {
    const printable = targets.filter(
      (item) => !isDirectSampling(item) && (item.status === "pending_print" || item.status === "draft"),
    );
    if (!printable.length) {
      void feedback.message.info("选中的批次均未处于待打印状态，无需标记已打印。");
      return;
    }
    setMarkingPrinted(true);
    setBulkNotice("");
    try {
      const response = await markBatchesPrinted.mutateAsync(printable.map((item) => item.id));
      selection.update(response.items);
      const skipped = targets.length - printable.length;
      setBulkNotice("");
      if (skipped)
        feedback.warning(
          "批次打印标记已完成",
          `已标记 ${printable.length} 个批次为已打印；${skipped} 个无需打印或非待打印批次跳过。`,
        );
      else feedback.success("批次已标记为已打印", `共 ${printable.length} 个批次。`);
    } catch (error) {
      showBulkNotice(error instanceof Error ? error.message : "标记已打印失败", "error");
    } finally {
      setMarkingPrinted(false);
    }
  }
  function beginReceive(targets: IntakeBatchListItem[]) {
    const printable = targets.filter(canConfirmIntakeReceipt);
    if (!printable.length) {
      void feedback.message.info("请选择已打印的入驻饲养批次或待接收的直接取材批次。");
      return;
    }
    setReceiptError("");
    setReceiptNeedsReselect(false);
    setPendingReceipt({ items: printable.map((item) => ({ ...item })), skipped: targets.length - printable.length });
  }
  async function receive(actualReceiptDates: Record<string, string>) {
    if (!pendingReceipt || markingReceived) return;
    const { items, skipped } = pendingReceipt;
    setMarkingReceived(true);
    setBulkNotice("");
    try {
      const response = await confirmBatchesReceipt.mutateAsync({
        ids: items.map((item) => item.id),
        actualReceiptDates,
        expectedVersions: Object.fromEntries(items.map((item) => [item.id, item.updatedAt])),
      });
      selection.update(response.batches);
      setPendingReceipt(null);
      setBulkNotice("");
      if (skipped)
        feedback.warning(
          "批次接收标记已完成",
          `已标记 ${items.length} 个批次为已接收；${skipped} 个不符合接收条件的批次跳过。`,
        );
      else feedback.success("批次已标记为已接收", `共 ${items.length} 个批次。`);
    } catch (error) {
      const stale = error instanceof ApiError && error.status === 409;
      setReceiptNeedsReselect(stale);
      setReceiptError(
        stale
          ? "所选批次已更新，请返回列表重新勾选后确认接收。"
          : error instanceof Error
            ? error.message
            : "标记已接收失败",
      );
      setBulkNotice("");
    } finally {
      setMarkingReceived(false);
    }
  }
  function closeReceipt() {
    if (markingReceived) return;
    if (receiptNeedsReselect) {
      selection.clear();
      void refresh();
    }
    setPendingReceipt(null);
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    await remove.mutateAsync(deleteTarget.id);
    selection.remove(deleteTarget.id);
    setDeleteTarget(null);
  }
  return {
    bulkNotice,
    bulkNoticeKind,
    showBulkNotice,
    markingPrinted,
    markingReceived,
    pendingReceipt,
    receiptError,
    receiptNeedsReselect,
    deleteTarget,
    setDeleteTarget,
    remove,
    markPrinted,
    beginReceive,
    receive,
    closeReceipt,
    confirmDelete,
    clearScope: () => {
      setDeleteTarget(null);
      setPendingReceipt(null);
    },
    resetReceipt: () => setPendingReceipt(null),
  };
}
