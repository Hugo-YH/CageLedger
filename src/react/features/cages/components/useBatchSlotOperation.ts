import { useRef, useState } from "react";
import type { Occupancy } from "../../../api/contracts";
import { useRefreshCageRoom, useSaveOccupancy } from "../../../api/cages";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";

export type BatchSlotWrite = { item: Occupancy; exists: boolean } | null;
type BatchKind = "save" | "clear";
interface BatchJob {
  kind: BatchKind;
  items: BatchSlotWrite[];
  completed: number;
  receipts: Occupancy[];
}

/** Keep one frozen, ordered job across partial failures without replaying confirmed writes. */
export function useBatchSlotOperation(
  roomId: string,
  beginOperation: () => () => boolean,
  onDone: (message: string) => void,
) {
  const save = useSaveOccupancy(roomId);
  const refresh = useRefreshCageRoom(roomId);
  const feedback = useOperationFeedback();
  const locked = useRef(false);
  const activeJob = useRef<BatchJob | null>(null);
  const [job, setJob] = useState<BatchJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(kind: BatchKind, prepare: () => BatchSlotWrite[]) {
    if (locked.current || (activeJob.current && activeJob.current.kind !== kind)) return;
    locked.current = true;
    const isCurrent = beginOperation();
    let current = activeJob.current || { kind, items: prepare(), completed: 0, receipts: [] };
    activeJob.current = current;
    setJob(current);
    setBusy(true);
    setError("");
    let complete = false;
    try {
      while (current.completed < current.items.length) {
        const write = current.items[current.completed];
        const response = write ? await save.mutateAsync({ ...write, deferInvalidate: true }) : undefined;
        current = {
          ...current,
          completed: current.completed + 1,
          receipts: response?.item ? [...current.receipts, response.item] : current.receipts,
        };
        activeJob.current = current;
        setJob(current);
      }
      complete = true;
    } catch (cause) {
      if (isCurrent()) {
        if (current.completed > 0)
          feedback.warning(
            "笼位批量操作部分完成",
            `已处理 ${current.completed}/${current.items.length} 个笼位，请核对编辑器中的失败原因后再操作。`,
          );
        setError(
          `已处理 ${current.completed} 个笼位；后续操作未完成：${cause instanceof Error ? cause.message : "请核对后重试"}`,
        );
      }
    } finally {
      try {
        await refresh();
      } finally {
        locked.current = false;
        setBusy(false);
      }
    }
    if (complete) {
      activeJob.current = null;
      setJob(null);
      if (isCurrent())
        onDone(
          kind === "save"
            ? `已批量保存 ${current.items.length} 个笼位。`
            : `已将 ${current.items.length} 个笼位设为空。`,
        );
    }
  }

  return { run, job, busy, error };
}
