import { useEffect, useRef, useState } from "react";

import {
  downloadFromUrl,
  getPdfExportJob,
  startPdfExport,
  type PdfExportJob,
  type PdfExportRequest,
} from "../../../api/client";

const POLL_INTERVAL_MS = 500;

export function usePdfExport() {
  const mounted = useRef(true);
  const [job, setJob] = useState<PdfExportJob | null>(null);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  async function exportPdf(payload: PdfExportRequest) {
    let current = await startPdfExport(payload);
    update(current);
    while (current.status === "queued" || current.status === "rendering") {
      await wait(POLL_INTERVAL_MS);
      current = await getPdfExportJob(current.id);
      update(current);
    }
    if (current.status === "failed") {
      throw new Error(current.error || "PDF 生成失败");
    }
    if (!current.downloadUrl) {
      throw new Error("PDF 已生成，但下载链接不可用");
    }
    downloadFromUrl(current.downloadUrl);
    return current;
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

function wait(delay: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay));
}
