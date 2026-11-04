import { useState } from "react";

import type { IntakeBatch, IntakeBatchListItem } from "../../../api/contracts";
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
  markPrinted: (items: IntakeBatchListItem[]) => Promise<void>;
  showBulkNotice: (message: string, kind?: "success" | "error" | "info") => void;
}) {
  const [pendingPrint, setPendingPrint] = useState<PendingIntakePrintJob | null>(null);
  const feedback = useOperationFeedback();

  async function renderPrint(items: IntakeBatch[], job: PendingIntakePrintJob, fillBlanks: boolean, popup: Window) {
    let contactPhones: Record<string, string> | undefined;
    if (job.kind === "standard") {
      try {
        const contacts = await prepareIntakePrintContacts(items.filter((item) => !isDirectSampling(item)));
        contactPhones = contacts.contactPhones;
        if (contacts.warning) feedback.warning("请核对笼卡联系电话", contacts.warning);
      } catch {
        feedback.warning("笼卡联系电话读取失败", "本次联系电话留空。请稍后核对实验人员信息并重新打印。");
      }
    }
    if (openIntakeCardPrint(items, { kind: job.kind, fillBlanks, targetWindow: popup, contactPhones })) {
      await markPrinted(items);
    } else {
      popup.close();
      showBulkNotice("所选批次没有可打印的笼卡，请核对后重试。");
    }
  }
  async function completeSavedPrint(intent: IntakeSaveIntent, item: IntakeBatch, popup: Window | null) {
    if (!intent.print || !popup) return;
    const saved = editor.adoptPrintedDraft(item);
    await renderPrint([saved], intent.print.job, intent.print.fillBlanks, popup);
  }
  async function executePrint(job: PendingIntakePrintJob, fillBlanks: boolean) {
    setPendingPrint(null);
    if (job.saveCurrent && editor.revision.current !== job.draftRevision) return;
    const popup = openIntakePrintWindow();
    if (!popup) {
      const message = "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。";
      if (job.saveCurrent) editor.setNotice(message);
      else showBulkNotice(message, "error");
      return;
    }
    if (job.saveCurrent) {
      const intent = saves.capture(job.draft!, job.exists, { job, fillBlanks }, job.draftRevision);
      await saves.run(intent, popup);
      return;
    }
    try {
      const items = await fetchIntakeBatchesForPrint(job.batches);
      await renderPrint(items, job, fillBlanks, popup);
    } catch (error) {
      popup.close();
      showBulkNotice(error instanceof Error ? error.message : "准备笼卡失败", "error");
    }
  }
  function requestPrint(targets: IntakeBatchListItem[], currentDraft?: IntakeBatch, exists = false) {
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
    pendingPrint,
    close: () => setPendingPrint(null),
    executePrint,
    requestPrint,
    printCurrentBatch,
    completeSavedPrint,
    clearSelection: () => setPendingPrint((current) => (current?.saveCurrent ? current : null)),
  };
}
