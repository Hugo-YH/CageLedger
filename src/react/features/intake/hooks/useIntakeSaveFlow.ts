import { useEffect, useRef, useState, type RefObject } from "react";

import type { IntakeBatch, IntakeRecognitionImageInput } from "../../../api/contracts";
import { intakeDuplicateDetails, useSaveIntakeBatch } from "../../../api/intake";
import type { IntakeSaveIntent, PendingDuplicateSave } from "../intakeViewTypes";
import { openIntakePrintWindow } from "../intakePrintWindow";

/** One write path owns the captured draft/images, duplicate token, and stale-response guard. */
export function useIntakeSaveFlow({
  mode,
  revision,
  snapshotImages,
  isCurrent,
  onSaved,
  onError,
  invalidate,
}: {
  mode: IntakeSaveIntent["mode"];
  revision: RefObject<number>;
  snapshotImages: () => IntakeRecognitionImageInput[];
  isCurrent: (intent: IntakeSaveIntent) => boolean;
  onSaved: (intent: IntakeSaveIntent, item: IntakeBatch, popup: Window | null) => void | Promise<void>;
  onError: (message: string) => void;
  invalidate: () => void;
}) {
  const mutation = useSaveIntakeBatch();
  const inFlight = useRef(false);
  const [duplicate, setDuplicate] = useState<PendingDuplicateSave | null>(null);
  const currentRevision = revision.current;
  useEffect(() => {
    setDuplicate((current) => (current && !isCurrent(current.intent) ? null : current));
  }, [currentRevision, isCurrent]);

  function capture(
    item: IntakeBatch,
    exists: boolean,
    print?: IntakeSaveIntent["print"],
    draftRevision = revision.current,
  ): IntakeSaveIntent {
    return { item, exists, mode, draftRevision, print, recognitionImages: snapshotImages() };
  }
  async function run(intent: IntakeSaveIntent, popup: Window | null = null, confirmation?: string) {
    if (inFlight.current || !isCurrent(intent)) {
      popup?.close();
      return;
    }
    inFlight.current = true;
    try {
      const response = await mutation.mutateAsync({
        item: intent.item,
        exists: intent.exists,
        checkDuplicates: true,
        reviewVersion: 2,
        recognitionImages: intent.recognitionImages,
        ...(confirmation ? { duplicateConfirmation: confirmation } : {}),
      });
      if (!isCurrent(intent)) {
        popup?.close();
        return;
      }
      setDuplicate(null);
      await onSaved(intent, response.item, popup);
    } catch (error) {
      popup?.close();
      if (!isCurrent(intent)) return;
      const details = intakeDuplicateDetails(error);
      if (details) {
        setDuplicate({ intent, details, error: confirmation ? "重复记录已更新，请重新核对后确认保存。" : "" });
      } else if (confirmation) {
        setDuplicate((current) =>
          current
            ? {
                ...current,
                error: error instanceof Error ? error.message : "确认保存失败，请重试。",
              }
            : null,
        );
      } else {
        onError(error instanceof Error ? error.message : intent.print ? "准备笼卡失败" : "保存失败");
      }
    } finally {
      inFlight.current = false;
    }
  }
  async function confirmDuplicate() {
    if (!duplicate || inFlight.current) return;
    if (!isCurrent(duplicate.intent)) {
      setDuplicate(null);
      return;
    }
    // Open synchronously in the confirmation click before the network request.
    const popup = duplicate.intent.print ? openIntakePrintWindow() : null;
    if (duplicate.intent.print && !popup) {
      setDuplicate({ ...duplicate, error: "打印窗口被浏览器拦截，请允许本站打开弹出窗口后重试。" });
      return;
    }
    await run(duplicate.intent, popup, duplicate.details.confirmationToken);
  }
  function dismissDuplicate() {
    invalidate();
    setDuplicate(null);
  }
  return {
    mutation,
    inFlight,
    capture,
    run,
    confirmDuplicate,
    dismissDuplicate,
    clearDuplicate: () => setDuplicate(null),
    pendingDuplicate: duplicate && isCurrent(duplicate.intent) ? duplicate : null,
  };
}
