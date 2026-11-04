import { useRef, useState } from "react";

import type {
  ResearcherImportFile,
  ResearcherImportPreview,
  ResearcherImportRequest,
  ResearcherImportResult,
} from "../../../contracts/researchers";
import { ApiError } from "../../api/client";
import { useImportResearchers, usePreviewResearcherImport } from "../../api/researchers";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { researcherError } from "./researcherFields";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function readResearcherFile(file: File): Promise<ResearcherImportFile> {
  if (!/\.xlsx$/i.test(file.name)) return Promise.reject(new Error("请选择 .xlsx 格式的 Excel 文件"));
  if (file.size > MAX_FILE_SIZE) return Promise.reject(new Error("Excel 文件不能超过 10 MiB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败，请重新选择"));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string" || !value.includes(",")) {
        reject(new Error("文件读取失败，请重新选择"));
        return;
      }
      resolve({ filename: file.name, data: value.slice(value.indexOf(",") + 1) });
    };
    reader.readAsDataURL(file);
  });
}

export function useResearcherImportFlow(onImported: (result: ResearcherImportResult) => void) {
  const previewMutation = usePreviewResearcherImport();
  const importMutation = useImportResearchers();
  const latest = useLatestRequest();
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<ResearcherImportFile | null>(null);
  const [preview, setPreview] = useState<ResearcherImportPreview | null>(null);
  const [error, setError] = useState("");
  const [needsPreview, setNeedsPreview] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const request = useRef<ResearcherImportRequest | null>(null);
  const submitting = useRef(false);

  async function previewFile(payload: ResearcherImportFile, current: () => boolean) {
    try {
      const result = await previewMutation.mutateAsync(payload);
      if (!current()) return;
      setPreview(result);
      setNeedsPreview(false);
    } catch (cause) {
      if (current()) setError(researcherError(cause));
    } finally {
      if (current()) setPreviewing(false);
    }
  }

  async function chooseFile(selected: File) {
    if (submitting.current) return;
    const current = latest.begin();
    request.current = null;
    setFileName(selected.name);
    setFile(null);
    setPreview(null);
    setError("");
    setNeedsPreview(false);
    setPreviewing(true);
    try {
      const payload = await readResearcherFile(selected);
      if (!current()) return;
      setFile(payload);
      await previewFile(payload, current);
    } catch (cause) {
      if (current()) {
        setError(researcherError(cause));
        setPreviewing(false);
      }
    }
  }

  async function repreview() {
    if (!file || submitting.current || previewing) return;
    const current = latest.begin();
    request.current = null;
    setError("");
    setPreview(null);
    setPreviewing(true);
    await previewFile(file, current);
  }

  async function confirmImport() {
    if (!file || !preview?.canImport || preview.counts.invalid > 0 || needsPreview || submitting.current) return;
    submitting.current = true;
    setImporting(true);
    setError("");
    const current = latest.begin();
    try {
      request.current ??= { ...file, confirmationToken: preview.confirmationToken, requestId: crypto.randomUUID() };
      const result = await importMutation.mutateAsync(request.current);
      if (current()) onImported(result);
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.status === 409) {
        setNeedsPreview(true);
        request.current = null;
        setError(`${researcherError(cause)}。请重新预览并核对后再确认导入。`);
      } else {
        setError(`${researcherError(cause)}。文件与预览已保留，重试将沿用本次请求编号。`);
      }
    } finally {
      submitting.current = false;
      if (current()) setImporting(false);
    }
  }

  return {
    fileName,
    file,
    preview,
    error,
    needsPreview,
    previewing,
    importing,
    chooseFile,
    repreview,
    confirmImport,
    invalidate: latest.invalidate,
    canConfirm: Boolean(file && preview?.canImport && preview.counts.invalid === 0 && !needsPreview && !previewing),
  };
}
