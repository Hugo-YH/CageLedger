import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadFromUrl, getPdfExportJob, startPdfExport, type PdfExportJob } from "../../../api/client";
import { TaskFeedbackContext, type TaskFeedbackApi } from "../../../components/TaskFeedbackContext";
import { usePdfExport } from "./usePdfExport";

vi.mock("../../../api/client", () => ({
  downloadFromUrl: vi.fn(),
  getPdfExportJob: vi.fn(),
  startPdfExport: vi.fn(),
}));

const ready: PdfExportJob = {
  id: "export-1",
  status: "ready",
  completed: 1,
  total: 1,
  filename: "sheet.pdf",
  error: "",
  downloadUrl: "/api/pdf-export-jobs/export-1/download",
};
const payload = { kind: "quantity_sheet" as const, ids: ["sheet-1"] };
const feedback: TaskFeedbackApi = {
  start: vi.fn(() => "task-1"),
  update: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  dismiss: vi.fn(),
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <TaskFeedbackContext.Provider value={feedback}>{children}</TaskFeedbackContext.Provider>
    </StrictMode>
  );
}

describe("usePdfExport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.mocked(feedback.start).mockReturnValue("task-1");
    vi.mocked(startPdfExport).mockResolvedValue(ready);
  });
  afterEach(() => vi.useRealTimers());

  it("locks immediately, coalesces repeated clicks and downloads only once", async () => {
    let resolveRequest: (job: PdfExportJob) => void = () => {};
    const initialRequest = new Promise<PdfExportJob>((resolve) => {
      resolveRequest = resolve;
    });
    vi.mocked(startPdfExport).mockReturnValue(initialRequest);
    const { result } = renderHook(usePdfExport, { wrapper });
    let first: Promise<PdfExportJob> | undefined;
    act(() => {
      first = result.current.exportPdf(payload);
      expect(result.current.exportPdf(payload)).toBe(first);
    });
    expect(result.current.isExporting).toBe(true);
    await act(async () => {
      resolveRequest(ready);
      await first;
    });
    expect(startPdfExport).toHaveBeenCalledTimes(1);
    expect(downloadFromUrl).toHaveBeenCalledExactlyOnceWith(ready.downloadUrl);
    expect(result.current.job).toEqual(ready);
    expect(result.current.isExporting).toBe(false);
    expect(feedback.complete).toHaveBeenCalledTimes(1);
  });

  it("releases the initial request lock on failure and permits retry", async () => {
    vi.mocked(startPdfExport).mockRejectedValueOnce(new Error("无法创建导出任务"));
    const { result } = renderHook(usePdfExport, { wrapper });
    await act(async () => {
      await expect(result.current.exportPdf(payload)).rejects.toThrow("无法创建导出任务");
    });
    expect(result.current.isExporting).toBe(false);
    expect(feedback.fail).toHaveBeenCalledWith("task-1", "无法创建导出任务");
    await act(async () => {
      await result.current.exportPdf(payload);
    });
    expect(startPdfExport).toHaveBeenCalledTimes(2);
    expect(downloadFromUrl).toHaveBeenCalledTimes(1);
  });

  it("does not leave a failed poll in the loading state", async () => {
    vi.mocked(startPdfExport).mockResolvedValue({ ...ready, status: "queued" });
    vi.mocked(getPdfExportJob).mockRejectedValue(new Error("查询任务失败"));
    const { result } = renderHook(usePdfExport, { wrapper });
    await act(async () => {
      const completion = expect(result.current.exportPdf(payload)).rejects.toThrow("查询任务失败");
      await vi.advanceTimersByTimeAsync(500);
      await completion;
    });
    expect(result.current.isExporting).toBe(false);
    expect(result.current.job).toMatchObject({ status: "failed", error: "查询任务失败" });
    expect(downloadFromUrl).not.toHaveBeenCalled();
  });

  it.each([
    { ...ready, status: "failed" as const, error: "生成超时" },
    { ...ready, downloadUrl: "" },
  ])("reports a terminal job error without downloading: $status", async (job) => {
    vi.mocked(startPdfExport).mockResolvedValue(job);
    const { result } = renderHook(usePdfExport, { wrapper });
    await act(async () => {
      await expect(result.current.exportPdf(payload)).rejects.toThrow();
    });
    expect(result.current.isExporting).toBe(false);
    expect(downloadFromUrl).not.toHaveBeenCalled();
    expect(feedback.fail).toHaveBeenCalledTimes(1);
  });

  it("keeps an export running in the background when the page unmounts", async () => {
    vi.mocked(startPdfExport).mockResolvedValue({ ...ready, status: "rendering" });
    vi.mocked(getPdfExportJob).mockResolvedValue(ready);
    const { result, unmount } = renderHook(usePdfExport, { wrapper });
    let completion: Promise<PdfExportJob> | undefined;
    await act(async () => {
      completion = result.current.exportPdf(payload);
      await Promise.resolve();
    });
    expect(result.current.isExporting).toBe(true);
    unmount();
    await vi.advanceTimersByTimeAsync(500);
    await completion;
    expect(downloadFromUrl).toHaveBeenCalledExactlyOnceWith(ready.downloadUrl);
    expect(feedback.complete).toHaveBeenCalledTimes(1);
  });

  it("keeps the export callback stable during job updates", async () => {
    const { result } = renderHook(usePdfExport, { wrapper });
    const original = result.current.exportPdf;
    await act(async () => {
      await result.current.exportPdf(payload);
    });
    expect(result.current.exportPdf).toBe(original);
  });
});
