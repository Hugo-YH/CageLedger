import {
  DIAGNOSTIC_ERROR_TYPES,
  DIAGNOSTIC_PAGES,
  DIAGNOSTIC_RESOURCES,
  DIAGNOSTIC_ROUTE_PARTS,
  type DiagnosticEvent,
  type DiagnosticPage,
  type FeedbackDiagnostics,
} from "../../contracts/feedbackDiagnostics";

const STORAGE_KEY = "cageledger.diagnostics.v1";
const WINDOW_MS = 300_000;
const MAX_EVENTS = 50;
let events: DiagnosticEvent[] = [];
let currentPage: DiagnosticPage = "unknown";
let restored = false;
let stopCollection: (() => void) | undefined;

function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
}

// Rebuild persisted events from explicit fields; never copy arbitrary storage values.
function restoreEvent(value: unknown): DiagnosticEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!integer(row.at, 4_102_444_800_000) || !member(DIAGNOSTIC_PAGES, row.page)) return null;
  const base = { at: row.at, page: row.page };
  if (row.kind === "navigation") return { ...base, kind: "navigation" };
  if (row.kind === "action" && member(["save", "delete", "download"] as const, row.action)) {
    return { ...base, kind: "action", action: row.action };
  }
  if (
    row.kind === "error" &&
    member(DIAGNOSTIC_ERROR_TYPES, row.errorType) &&
    member(["runtime", "promise", "react", "resource"] as const, row.source)
  ) {
    return {
      ...base,
      kind: "error",
      errorType: row.errorType,
      source: row.source,
      ...(integer(row.line, 10_000_000) ? { line: row.line } : {}),
      ...(integer(row.column, 10_000_000) ? { column: row.column } : {}),
    };
  }
  if (
    row.kind === "request" &&
    member(["GET", "POST", "PUT", "PATCH", "DELETE"] as const, row.method) &&
    typeof row.route === "string" &&
    safeStoredRoute(row.route) &&
    integer(row.status, 599) &&
    integer(row.durationMs, 120_000)
  ) {
    return {
      ...base,
      kind: "request",
      method: row.method,
      route: row.route,
      status: row.status,
      durationMs: row.durationMs,
      ...(typeof row.requestId === "string" && /^[a-f0-9]{16}$/.test(row.requestId)
        ? { requestId: row.requestId }
        : {}),
    };
  }
  return null;
}

function safeStoredRoute(route: string) {
  const parts = route.split("/");
  return (
    parts.length >= 3 &&
    parts.length <= 8 &&
    parts[0] === "" &&
    parts[1] === "api" &&
    member(DIAGNOSTIC_RESOURCES, parts[2]) &&
    parts.slice(3).every((part) => member(DIAGNOSTIC_ROUTE_PARTS, part))
  );
}

export function diagnosticRoute(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/")) return null;
    const parts = parsed.pathname.split("/").slice(2);
    if (parts[0] === "auth") return null;
    const resource = member(DIAGNOSTIC_RESOURCES, parts[0]) ? parts[0] : ":other";
    const suffix = parts
      .slice(1, 6)
      .filter(Boolean)
      .map((part) => (member(DIAGNOSTIC_ROUTE_PARTS, part) ? part : ":id"));
    return ["", "api", resource, ...suffix].join("/");
  } catch {
    return null;
  }
}

function prune(now = Date.now()) {
  events = events.filter((event) => event.at >= now - WINDOW_MS && event.at <= now).slice(-MAX_EVENTS);
}

function restore() {
  if (restored) return;
  restored = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw && raw.length <= 16_384) {
      const rows: unknown = JSON.parse(raw);
      if (Array.isArray(rows))
        events = rows
          .slice(-MAX_EVENTS)
          .map(restoreEvent)
          .filter((event): event is DiagnosticEvent => event !== null);
    }
  } catch {
    /* Diagnostics must work when storage is unavailable. */
  }
  prune();
}

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    /* Keep the bounded in-memory buffer instead. */
  }
}

function record(event: DiagnosticEvent) {
  restore();
  events.push(event);
  prune();
  persist();
}

export function clearDiagnostics() {
  events = [];
  currentPage = "unknown";
  restored = true;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Optional storage. */
  }
}

export function setDiagnosticPage(view: string) {
  const page: DiagnosticPage =
    view === "dashboard"
      ? "overview"
      : view === "cages"
        ? "cages"
        : view.startsWith("intake")
          ? "intake"
          : view.startsWith("quarantine")
            ? "quarantine"
            : view.startsWith("animal-inspection")
              ? "animal-inspection"
              : view.startsWith("billing")
                ? "billing"
                : view === "workflow-center"
                  ? "workflows"
                  : view === "feedback"
                    ? "feedback"
                    : view === "cage-card-scanner"
                      ? "scanner"
                      : ["rooms", "data", "system", "users", "logs"].includes(view)
                        ? "settings"
                        : "unknown";
  if (currentPage === page) return;
  currentPage = page;
  record({ at: Date.now(), page, kind: "navigation" });
}

export function recordDiagnosticAction(action: "save" | "delete" | "download") {
  record({ at: Date.now(), page: currentPage, kind: "action", action });
}

export function recordDiagnosticError(
  error: unknown,
  source: "runtime" | "promise" | "react" | "resource",
  line?: number,
  column?: number,
) {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "UnknownError";
  if (name === "AbortError") return;
  record({
    at: Date.now(),
    page: currentPage,
    kind: "error",
    errorType: source === "resource" ? "ResourceError" : member(DIAGNOSTIC_ERROR_TYPES, name) ? name : "UnknownError",
    source,
    ...(integer(line, 10_000_000) ? { line } : {}),
    ...(integer(column, 10_000_000) ? { column } : {}),
  });
}

export function recordDiagnosticRequest(
  url: string,
  method: string,
  status: number,
  durationMs: number,
  requestId?: string | null,
) {
  const route = diagnosticRoute(url);
  if (!route || !member(["GET", "POST", "PUT", "PATCH", "DELETE"] as const, method)) return;
  record({
    at: Date.now(),
    page: currentPage,
    kind: "request",
    route,
    method,
    status: Math.max(0, Math.min(599, Math.round(status))),
    durationMs: Math.max(0, Math.min(120_000, Math.round(durationMs))),
    ...(requestId && /^[a-f0-9]{16}$/.test(requestId) ? { requestId } : {}),
  });
}

export function captureDiagnostics(): FeedbackDiagnostics {
  restore();
  const capturedAt = Date.now();
  prune(capturedAt);
  persist();
  return {
    schemaVersion: 1,
    capturedAt,
    windowSeconds: 300,
    events: events.map((event) => ({ ...event })),
  };
}

export function startDiagnostics() {
  if (stopCollection) return stopCollection;
  restore();
  const onError = (event: Event) => {
    if (event instanceof ErrorEvent) recordDiagnosticError(event.error, "runtime", event.lineno, event.colno);
    else recordDiagnosticError(null, "resource");
  };
  const onRejection = (event: PromiseRejectionEvent) => recordDiagnosticError(event.reason, "promise");
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  stopCollection = () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    stopCollection = undefined;
  };
  return stopCollection;
}
