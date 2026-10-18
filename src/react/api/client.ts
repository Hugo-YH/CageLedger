import { diagnosticRoute, recordDiagnosticAction, recordDiagnosticRequest } from "../diagnostics/collector";

export async function requestFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const startedAt = performance.now();
  const method = (init.method || "GET").toUpperCase();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (!init.signal?.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
      recordDiagnosticRequest(url, method, 0, performance.now() - startedAt);
    }
    throw error;
  }
  if (!response.ok && response.status !== 304) {
    recordDiagnosticRequest(
      url,
      method,
      response.status,
      performance.now() - startedAt,
      response.headers.get("X-Request-ID"),
    );
  } else if (diagnosticRoute(url) && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    recordDiagnosticAction(method === "DELETE" ? "delete" : "save");
  }
  return response;
}

export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
    metadata: { code?: string; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    const fields = errorFields(payload);
    this.code = metadata.code || (typeof fields.code === "string" && fields.code ? fields.code : `HTTP_${status}`);
    this.requestId = traceId(metadata.requestId) || traceId(fields.requestId);
    this.details = fields.details;
  }
}

function traceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{16}$/.test(value) ? value : undefined;
}

function errorFields(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function requestOptions(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers,
  };
}

async function responseJson(
  response: Response,
  init: RequestInit,
  context?: { url: string; startedAt: number },
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    if (!(error instanceof SyntaxError)) throw error;
    if (!response.ok) return {};
    if (context)
      recordDiagnosticRequest(
        context.url,
        (init.method || "GET").toUpperCase(),
        response.status,
        performance.now() - context.startedAt,
        response.headers.get("X-Request-ID"),
      );
    throw new ApiError(
      "服务器返回的数据格式无效，请刷新后重试",
      response.status,
      {},
      {
        code: "INVALID_JSON_RESPONSE",
        requestId: response.headers.get("X-Request-ID"),
      },
    );
  }
}

function responseError(response: Response, payload: unknown): ApiError {
  const message = errorFields(payload).error;
  return new ApiError(
    typeof message === "string" && message ? message : `Request failed with ${response.status}`,
    response.status,
    payload,
    { requestId: response.headers.get("X-Request-ID") },
  );
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const startedAt = performance.now();
  const response = await requestFetch(url, requestOptions(init));
  if (response.status === 204) return undefined as T;
  const payload = await responseJson(response, init, { url, startedAt });
  if (!response.ok) throw responseError(response, payload);
  return payload as T;
}

export type ConditionalJson<T> = { value: T; etag: string };

/** Revalidate Query-owned data without keeping a second response cache. */
export async function requestConditionalJson<T>(
  url: string,
  previous?: ConditionalJson<T>,
  signal?: AbortSignal,
): Promise<ConditionalJson<T>> {
  const headers = new Headers();
  if (previous?.etag) headers.set("If-None-Match", previous.etag);
  const init = { headers, signal };
  const startedAt = performance.now();
  const response = await requestFetch(url, requestOptions(init));
  signal?.throwIfAborted();
  if (response.status === 304) {
    if (previous?.etag) return previous;
    throw new ApiError("服务器未返回可用的缓存数据，请重试", 304, {}, { code: "INVALID_NOT_MODIFIED_RESPONSE" });
  }
  const payload = await responseJson(response, init, { url, startedAt });
  if (!response.ok) throw responseError(response, payload);
  return { value: payload as T, etag: response.headers.get("ETag") || "" };
}

export function requestMultipart<T>(url: string, form: FormData, init: Omit<RequestInit, "body"> = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // The browser supplies the multipart boundary for the actual FormData body.
  headers.delete("Content-Type");
  return requestJson<T>(url, { method: "POST", ...init, headers, body: form });
}

export async function requestDownload(url: string, init: RequestInit = {}): Promise<string> {
  const response = await requestFetch(url, requestOptions(init));
  if (!response.ok) {
    throw responseError(response, await responseJson(response, init));
  }
  const filename = downloadFilename(response.headers.get("Content-Disposition")) || "CageLedger-export";
  const body = await response.blob();
  recordDiagnosticAction("download");
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
  if (diagnosticRoute(url)) recordDiagnosticAction("download");
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
