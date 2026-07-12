export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(payload.error || `Request failed with ${response.status}`, response.status, payload);
  }
  return payload;
}

export async function requestDownload(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(payload.error || `Request failed with ${response.status}`, response.status, payload);
  }
  const filename = downloadFilename(response.headers.get("Content-Disposition")) || "CageLedger-export";
  const body = await response.blob();
  const href = URL.createObjectURL(body);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  return filename;
}

export type PdfExportRequest =
  | { kind: "quantity_sheet"; ids: string[] }
  | { kind: "billing_statement"; items: Array<{ month: string; pi: string; sourceType: string }> };

export type PdfExportJob = {
  id: string;
  status: "queued" | "rendering" | "ready" | "failed";
  completed: number;
  total: number;
  filename: string;
  error: string;
  downloadUrl: string;
};

export function startPdfExport(payload: PdfExportRequest) {
  return requestJson<PdfExportJob>("/api/pdf-exports", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPdfExportJob(jobId: string) {
  return requestJson<PdfExportJob>(`/api/pdf-export-jobs/${encodeURIComponent(jobId)}`);
}

export function downloadFromUrl(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadFilename(value: string | null) {
  if (!value) return "";
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return value.match(/filename="?([^";]+)"?/i)?.[1] || "";
}
