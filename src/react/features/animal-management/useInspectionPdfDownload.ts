import { useRef, useState } from "react";
import { downloadAnimalInspectionPdf } from "../../api/animalManagement";
import { useOperationFeedback } from "../../hooks/useOperationFeedback";

export function useInspectionPdfDownload() {
  const feedback = useOperationFeedback();
  const lock = useRef(false);
  const [pendingId, setPendingId] = useState("");
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  async function download(id: string) {
    if (lock.current) return;
    lock.current = true;
    setPendingId(id);
    setFailure(null);
    try {
      const filename = await downloadAnimalInspectionPdf(id);
      feedback.success("巡检 PDF 已生成，下载已开始", filename);
    } catch (error) {
      setFailure({ id, message: error instanceof Error ? error.message : "巡检 PDF 导出失败，请重试" });
    } finally {
      lock.current = false;
      setPendingId("");
    }
  }
  return { download, pendingId, failure };
}
