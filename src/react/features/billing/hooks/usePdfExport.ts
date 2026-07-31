import { useEffect, useRef, useState } from "react";

import {
  downloadFromUrl,
  getPdfExportJob,
  startPdfExport,
  type PdfExportJob,
  type PdfExportRequest,
} from "../../../api/client";
import { useTaskFeedback } from "../../../components/TaskFeedbackContext";

const POLL_INTERVAL_MS = 500;

export function usePdfExport() {
  const mounted = useRef(true);
  const [job, setJob] = useState<PdfExportJob | null>(null);
  const tasks = useTaskFeedback();

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  async function exportPdf(payload: PdfExportRequest) {
    const taskId = tasks.start({ title: "正在生成 PDF", detail: exportLabel(payload), progress: 0 });
    try {
      let current = await startPdfExport(payload);
      update(current);
      while (current.status === "queued" || current.status === "rendering") {
        tasks.update(taskId, { detail: progressLabel(current), progress: jobProgress(current) });
        await wait(POLL_INTERVAL_MS);
        current = await getPdfExportJob(current.id);
        update(current);
      }
      tasks.update(taskId, { progress: 100 });
      if (current.status === "failed") throw new Error(current.error || "PDF 生成失败");
      if (!current.downloadUrl) throw new Error("PDF 已生成，但下载链接不可用");
      downloadFromUrl(current.downloadUrl);
      tasks.complete(taskId, "PDF 已生成，下载已开始。");
      return current;
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF 生成失败";
      tasks.fail(taskId, message);
      throw error;
    }
  }

  function update(next: PdfExportJob) {
    if (mounted.current) setJob(next);
  }

  return {
    exportPdf,
    job,
    isExporting: job?.status === "queued" || job?.status === "rendering",
  };
}

function exportLabel(payload: PdfExportRequest) {
  if (payload.kind === "billing_statement") return "正在汇总结算单数据。";
  return payload.ids.length > 1 ? `正在生成 ${payload.ids.length} 份数量统计表。` : "正在生成数量统计表。";
}

function progressLabel(job: PdfExportJob) {
  return job.total > 1 ? `已完成 ${job.completed}/${job.total} 份。` : "正在排版并生成文件。";
}

function jobProgress(job: PdfExportJob) {
  return job.total > 1 ? Math.round((job.completed / job.total) * 100) : undefined;
}

function wait(delay: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay));
}
