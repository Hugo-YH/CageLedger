import { useCallback, useEffect, useRef, useState } from "react";

import {
  downloadFromUrl,
  getPdfExportJob,
  startPdfExport,
  type PdfExportJob,
  type PdfExportRequest,
} from "../../../api/client";
import { useTaskFeedback } from "../../../components/TaskFeedbackContext";

const INITIAL_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 2000;

export function usePdfExport() {
  const mounted = useRef(true);
  const inFlight = useRef<Promise<PdfExportJob> | null>(null);
  const currentJob = useRef<PdfExportJob | null>(null);
  const [job, setJob] = useState<PdfExportJob | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const tasks = useTaskFeedback();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const exportPdf = useCallback(
    (payload: PdfExportRequest) => {
      // Lock before React commits the loading state, including the initial POST.
      if (inFlight.current) return inFlight.current;
      if (mounted.current) {
        setIsExporting(true);
        currentJob.current = null;
        setJob(null);
      }
      const run = async () => {
        const taskId = tasks.start({ title: "正在生成 PDF", detail: exportLabel(payload), progress: 0 });
        let previousTaskUpdate: { detail: string; progress: number | undefined } | null = null;
        const updateTaskProgress = (next: PdfExportJob) => {
          const update = { detail: progressLabel(next), progress: jobProgress(next) };
          if (sameTaskProgress(previousTaskUpdate, update)) return;
          previousTaskUpdate = update;
          tasks.update(taskId, update);
        };
        const updateJob = (next: PdfExportJob) => {
          if (!mounted.current || samePdfExportJob(currentJob.current, next)) return;
          currentJob.current = next;
          setJob(next);
        };
        try {
          let current = await startPdfExport(payload);
          let pollInterval = INITIAL_POLL_INTERVAL_MS;
          updateJob(current);
          while (current.status === "queued" || current.status === "rendering") {
            updateTaskProgress(current);
            await wait(pollInterval);
            const previous = current;
            current = await getPdfExportJob(previous.id);
            pollInterval = nextPollInterval(previous, current, pollInterval);
            updateJob(current);
          }
          if (current.status === "failed") throw new Error(current.error || "PDF 生成失败");
          if (!current.downloadUrl) throw new Error("PDF 已生成，但下载链接不可用");
          downloadFromUrl(current.downloadUrl);
          tasks.complete(taskId, "PDF 已生成，下载已开始。");
          return current;
        } catch (error) {
          const message = error instanceof Error ? error.message : "PDF 生成失败";
          if (mounted.current && currentJob.current) {
            const failed = { ...currentJob.current, status: "failed" as const, error: message };
            if (!samePdfExportJob(currentJob.current, failed)) {
              currentJob.current = failed;
              setJob(failed);
            }
          }
          tasks.fail(taskId, message);
          throw error;
        }
      };
      const pending = Promise.resolve()
        .then(run)
        .finally(() => {
          inFlight.current = null;
          if (mounted.current) setIsExporting(false);
        });
      inFlight.current = pending;
      return pending;
    },
    [tasks],
  );

  return {
    exportPdf,
    job,
    isExporting,
  };
}

function samePdfExportJob(previous: PdfExportJob | null, next: PdfExportJob) {
  return Boolean(
    previous &&
    previous.id === next.id &&
    previous.status === next.status &&
    previous.completed === next.completed &&
    previous.total === next.total &&
    previous.filename === next.filename &&
    previous.error === next.error &&
    previous.downloadUrl === next.downloadUrl,
  );
}

function sameTaskProgress(
  previous: { detail: string; progress: number | undefined } | null,
  next: { detail: string; progress: number | undefined },
) {
  return previous?.detail === next.detail && previous.progress === next.progress;
}

function nextPollInterval(previous: PdfExportJob, current: PdfExportJob, interval: number) {
  if (previous.status !== current.status || previous.completed !== current.completed) return INITIAL_POLL_INTERVAL_MS;
  return Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
}

export function settlementExportProgress(completed = 0, total = 0) {
  return total > 1 ? `正在导出 ${completed}/${total}` : "PDF 正在生成，完成后自动下载。";
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
