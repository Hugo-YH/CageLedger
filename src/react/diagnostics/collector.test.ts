import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  captureDiagnostics,
  clearDiagnostics,
  diagnosticRoute,
  recordDiagnosticAction,
  recordDiagnosticError,
  recordDiagnosticRequest,
  setDiagnosticPage,
  startDiagnostics,
} from "./collector";
import { requestFetch } from "../api/client";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
  clearDiagnostics();
});
afterEach(() => {
  clearDiagnostics();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps only route templates, never query strings, identifiers, external URLs or auth requests", () => {
  expect(diagnosticRoute("/api/quantity-sheets/邱素娟-Z2025060?token=SECRET#private")).toBe("/api/quantity-sheets/:id");
  expect(diagnosticRoute("/api/feedback/private-id/attachments?requestId=SECRET")).toBe(
    "/api/feedback/:id/attachments",
  );
  expect(diagnosticRoute("https://example.com/api/feedback")).toBeNull();
  expect(diagnosticRoute("/api/auth/login?password=SECRET")).toBeNull();
  expect(diagnosticRoute("/api/unknown-private-resource/private-name")).toBe("/api/:other/:id");
});

it("bounds the buffer by both age and count, and captures immutable snapshots", () => {
  setDiagnosticPage("billing-monthly-summary");
  const first = captureDiagnostics();
  for (let index = 0; index < 70; index++) recordDiagnosticAction("save");
  expect(captureDiagnostics().events).toHaveLength(50);
  expect(first.events).toHaveLength(1);
  vi.advanceTimersByTime(300_001);
  expect(captureDiagnostics().events).toEqual([]);
});

it("uses one capture timestamp so records at the window boundary remain valid", () => {
  recordDiagnosticAction("save");
  const eventAt = Date.now();
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValueOnce(eventAt + 300_000)
    .mockReturnValue(eventAt + 300_001);
  const snapshot = captureDiagnostics();
  expect(snapshot.events).toHaveLength(1);
  expect(snapshot.capturedAt - snapshot.events[0].at).toBeLessThanOrEqual(300_000);
  clock.mockRestore();
});

it("records error categories without messages, stacks, rejection data or resource URLs", () => {
  const stop = startDiagnostics();
  const errorEvent = new ErrorEvent("error", {
    cancelable: true,
    error: new TypeError("password=SECRET 邱素娟"),
    lineno: 32,
    colno: 7,
    filename: "https://private.test/SECRET",
  });
  errorEvent.preventDefault();
  window.dispatchEvent(errorEvent);
  recordDiagnosticError({ message: "SECRET", token: "SECRET" }, "promise");
  recordDiagnosticError(new DOMException("SECRET", "AbortError"), "promise");
  const snapshot = captureDiagnostics();
  expect(snapshot.events).toHaveLength(2);
  expect(snapshot.events[0]).toMatchObject({ kind: "error", errorType: "TypeError", source: "runtime", line: 32 });
  expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|邱素娟|private\.test/);
  stop();
  window.dispatchEvent(new Event("error"));
  expect(captureDiagnostics().events).toHaveLength(2);
});

it("keeps valid trace ids and drops arbitrary response identifiers", () => {
  recordDiagnosticRequest("/api/feedback/SECRET", "GET", 500, 12.3, "abcdef0123456789");
  recordDiagnosticRequest("/api/feedback/SECRET", "GET", 500, 4, "SECRET");
  expect(captureDiagnostics().events[0]).toMatchObject({ requestId: "abcdef0123456789", durationMs: 12 });
  expect(captureDiagnostics().events[1]).not.toHaveProperty("requestId");
  expect(JSON.stringify(captureDiagnostics())).not.toContain("SECRET");
});

it("collects failed HTTP and network requests, ignores cancelled requests and successful reads", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("SECRET", { status: 500, headers: { "X-Request-ID": "0123456789abcdef" } }))
      .mockRejectedValueOnce(new TypeError("SECRET"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockRejectedValueOnce(new DOMException("cancelled", "AbortError")),
  );
  await requestFetch("/api/feedback?name=SECRET");
  await expect(requestFetch("/api/quantity-sheets/SECRET")).rejects.toThrow();
  await requestFetch("/api/feedback");
  await expect(requestFetch("/api/feedback")).rejects.toThrow();
  expect(captureDiagnostics().events).toHaveLength(2);
  expect(JSON.stringify(captureDiagnostics())).not.toContain("SECRET");
});

it("continues normal API requests when session storage is unavailable", async () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
  const response = await requestFetch("/api/feedback");
  expect(response.status).toBe(500);
  expect(captureDiagnostics().events).toHaveLength(1);
  spy.mockRestore();
});

it("restores only safe persisted fields after reload and clears records on sign-out", async () => {
  window.sessionStorage.setItem(
    "cageledger.diagnostics.v1",
    JSON.stringify([
      {
        at: Date.now(),
        page: "billing",
        kind: "request",
        method: "GET",
        route: "/api/feedback/:id",
        status: 500,
        durationMs: 3,
        token: "SECRET",
        requestId: "SECRET",
      },
      {
        at: Date.now(),
        page: "billing",
        kind: "request",
        method: "GET",
        route: "/api/feedback/SECRET",
        status: 500,
        durationMs: 3,
      },
    ]),
  );
  vi.resetModules();
  const reloaded = await import("./collector");
  const snapshot = reloaded.captureDiagnostics();
  expect(snapshot.events).toHaveLength(1);
  expect(JSON.stringify(snapshot)).not.toContain("SECRET");
  reloaded.clearDiagnostics();
  expect(reloaded.captureDiagnostics().events).toEqual([]);
});
