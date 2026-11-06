import { useEffect, useRef, useState } from "react";

import type { IntakeBatch, IntakeBatchListItem } from "../../../api/contracts";
import type { IntakePrintBatch } from "../../../../contracts/intake";
import { fetchIntakeBatchesForPrint } from "../../../api/intake";
import { isDirectSampling, missingIntakeRequiredFields, normalizeIntakeBatch } from "../../../../domain/intake";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import {
  openIntakeCardPrint,
  planIntakeCardPrint,
  type IntakeCardPrintKind,
  type IntakePrintRoom,
} from "../../../print/intakeCards";
import type { IntakeSaveIntent, PendingIntakePrintJob } from "../intakeViewTypes";
import { openIntakePrintWindow } from "../intakePrintWindow";
import { prepareIntakePrintContacts } from "../intakePrintContacts";
import type { useIntakeEditor } from "./useIntakeEditor";
import type { useIntakeSaveFlow } from "./useIntakeSaveFlow";

type PrintOperation = {
  popup: Window;
  controller: AbortController;
  writing: boolean;
  rendered: boolean;
  timer: number;
};

export function useIntakePrintActions({
  editor,
  saves,
  roomNames,
  printRooms,
  markPrinted,
  showBulkNotice,
}: {
  editor: ReturnType<typeof useIntakeEditor>;
  saves: ReturnType<typeof useIntakeSaveFlow>;
  roomNames: string[];
  printRooms: IntakePrintRoom[];
  markPrinted: (items: Pick<IntakePrintBatch, "id" | "intakePurpose" | "status">[]) => Promise<void>;
  showBulkNotice: (message: string, kind?: "success" | "error" | "info") => void;
}) {
  const [pendingPrint, setPendingPrint] = useState<PendingIntakePrintJob | null>(null);
  const [preparing, setPreparing] = useState(false);
  const active = useRef<PrintOperation | null>(null);
  const mounted = useRef(true);
  const feedback = useOperationFeedback();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const operation = active.current;
      if (!operation) return;
      window.clearInterval(operation.timer);
      operation.controller.abort();
      if (!operation.rendered && !operation.popup.closed) operation.popup.close();
    };
  }, []);

  function finish(operation: PrintOperation) {
    window.clearInterval(operation.timer);
    if (active.current !== operation) return;
    active.current = null;
    if (mounted.current) setPreparing(false);
  }
  function cancel(operation: PrintOperation) {
    window.clearInterval(operation.timer);
    operation.controller.abort();
    if (!operation.popup.closed) operation.popup.close();
    // A started save/print-record write owns the lock until it reconciles normally.
    if (!operation.writing) finish(operation);
  }
  function begin(popup: Window, writing = false): PrintOperation {
    const operation: PrintOperation = { popup, controller: new AbortController(), writing, rendered: false, timer: 0 };
    active.current = operation;
    if (mounted.current) setPreparing(true);
    operation.timer = window.setInterval(() => {
      if (popup.closed) cancel(operation);
    }, 200);
    return operation;
  }
  function assertPreparing(operation: PrintOperation) {
    if (!mounted.current || operation.popup.closed || active.current !== operation) cancel(operation);
    operation.controller.signal.throwIfAborted();
  }

  async function renderPrint(
    items: IntakePrintBatch[],
    job: PendingIntakePrintJob,
    fillBlanks: boolean,
    operation: PrintOperation,
  ) {
    // A completed save now enters cancellable, read-only print preparation.
    operation.writing = false;
    assertPreparing(operation);
    let contactPhones: Record<string, string> | undefined;
    if (job.kind === "standard") {
      try {
        const contacts = await prepareIntakePrintContacts(
          items.filter((item) => !isDirectSampling(item)),
          operation.controller.signal,
        );
        assertPreparing(operation);
        contactPhones = contacts.contactPhones;
        if (contacts.warning) feedback.warning("请核对笼卡联系电话", contacts.warning);
      } catch {
        assertPreparing(operation);
        feedback.warning("笼卡联系电话读取失败", "本次联系电话留空。请稍后核对实验人员信息并重新打印。");
      }
    }
    assertPreparing(operation);
    if (openIntakeCardPrint(items, { kind: job.kind, fillBlanks, targetWindow: operation.popup, contactPhones })) {
      operation.rendered = true;
      operation.writing = true;
      if (mounted.current) setPreparing(false);
      await markPrinted(items);
    } else {
      operation.popup.close();
      showBulkNotice("所选批次没有可打印的笼卡，请核对后重试。");
    }
  }
  async function completeSavedPrint(intent: IntakeSaveIntent, item: IntakeBatch, popup: Window | null) {
    if (!intent.print || !popup) return;
    if (active.current && active.current.popup !== popup) {
      popup.close();
      return;
    }
    const owned = !active.current;
    const operation = active.current || begin(popup);
    try {
      assertPreparing(operation);
      const saved = editor.adoptPrintedDraft(item);
      await renderPrint([saved], intent.print.job, intent.print.fillBlanks, operation);
    } catch (error) {
      if (!operation.controller.signal.aborted) throw error;
    } finally {
      if (owned) finish(operation);
    }
  }
  async function executePrint(job: PendingIntakePrintJob, fillBlanks: boolean) {
    if (active.current || !mounted.current) return;
    setPendingPrint(null);
    if (job.saveCurrent && editor.revision.current !== job.draftRevision) return;
    const popup = openIntakePrintWindow();
    if (!popup) {
      const message = "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。";
      if (job.saveCurrent) editor.setNotice(message);
      else showBulkNotice(message, "error");
      return;
    }
    const operation = begin(popup, job.saveCurrent);
    try {
      if (job.saveCurrent) {
        const intent = saves.capture(job.draft!, job.exists, { job, fillBlanks }, job.draftRevision);
        await saves.run(intent, popup);
        return;
      }
      const items = await fetchIntakeBatchesForPrint(job.batches, operation.controller.signal);
      assertPreparing(operation);
      await renderPrint(items, job, fillBlanks, operation);
    } catch (error) {
      if (!popup.closed) popup.close();
      if (!operation.controller.signal.aborted && mounted.current)
        showBulkNotice(error instanceof Error ? error.message : "准备笼卡失败", "error");
    } finally {
      finish(operation);
    }
  }
  function requestPrint(targets: IntakeBatchListItem[], currentDraft?: IntakeBatch, exists = false) {
    if (active.current) return;
    if (!editor.requireRooms()) return;
    const plan = planIntakeCardPrint(targets, printRooms);
    if (plan.disabledReason) {
      if (currentDraft) editor.setNotice(plan.disabledReason);
      else showBulkNotice(plan.disabledReason);
      return;
    }
    const job: PendingIntakePrintJob = {
      batches: targets,
      draft: currentDraft,
      kind: plan.kind as IntakeCardPrintKind,
      cardCount: plan.cardCount,
      pageSize: plan.pageSize,
      missing: plan.missing,
      saveCurrent: Boolean(currentDraft),
      exists,
      draftRevision: editor.revision.current,
    };
    if (job.missing) setPendingPrint(job);
    else void executePrint(job, false);
  }
  function printCurrentBatch() {
    if (!editor.requireRooms() || editor.recognition.reading) return;
    const item = normalizeIntakeBatch(editor.draft, roomNames);
    if (isDirectSampling(item)) {
      void feedback.message.info("直接取材批次无需打印笼卡。");
      return;
    }
    const missing = missingIntakeRequiredFields(item, { forPrint: true });
    if (missing.length) {
      editor.setNotice(`打印前请填写必填项目：${missing.join("、")}。`);
      return;
    }
    if (!item.quantity || item.quantity <= 0 || item.finalCardCount <= 0) {
      editor.setNotice("打印前请填写动物数量和打印张数。");
      return;
    }
    requestPrint([item], item, editor.editing);
  }
  return {
    preparing,
    pendingPrint,
    close: () => setPendingPrint(null),
    executePrint,
    requestPrint,
    printCurrentBatch,
    completeSavedPrint,
    clearSelection: () => setPendingPrint((current) => (current?.saveCurrent ? current : null)),
  };
}
