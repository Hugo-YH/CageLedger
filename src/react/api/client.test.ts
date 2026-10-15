import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, requestDownload, requestJson, requestMultipart } from "./client";
import { captureDiagnostics, clearDiagnostics } from "../diagnostics/collector";

describe("requestJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearDiagnostics();
  });

  it("returns typed JSON payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(requestJson<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
  });

  it("normalizes API failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 }));
    await expect(requestJson("/api/users")).rejects.toMatchObject({ status: 403, message: "denied" });
  });

  it("does not turn an aborted response body into a successful empty payload", async () => {
    const controller = new AbortController();
    const response = new Response("{}");
    vi.spyOn(response, "json").mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(requestJson("/api/users", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("rejects an empty successful JSON response instead of returning a successful empty object", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await expect(requestJson("/api/health")).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      code: "INVALID_JSON_RESPONSE",
    });
  });

  it("supports an explicit no-content response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(requestJson<void>("/api/example", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("retains server error fields, trace headers, and status without changing the error message", async () => {
    const payload = { error: "已更新，请刷新", code: "VERSION_CONFLICT", details: { field: "updatedAt" } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 409,
        headers: { "X-Request-ID": "abcdef0123456789" },
      }),
    );
    await expect(requestJson("/api/quantity-sheets/record")).rejects.toMatchObject({
      message: payload.error,
      status: 409,
      code: "VERSION_CONFLICT",
      requestId: "abcdef0123456789",
      details: payload.details,
      payload,
    });
  });

  it.each([null, ["not-an-error-object"], { error: { unexpected: true } }])(
    "handles valid JSON error bodies that do not contain an error string: %j",
    async (body) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 403 }));
      await expect(requestJson("/api/users")).rejects.toMatchObject({
        message: "Request failed with 403",
        code: "HTTP_403",
        payload: body,
      });
    },
  );

  it("keeps HTTP errors meaningful when the server responds with HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>private server details</html>", {
        status: 502,
        headers: { "X-Request-ID": "abcdef0123456789" },
      }),
    );
    await expect(requestJson("/api/users")).rejects.toMatchObject({
      status: 502,
      code: "HTTP_502",
      requestId: "abcdef0123456789",
      payload: {},
    });
  });

  it("keeps only valid trace identifiers and supports old body-level request ids", () => {
    expect(new ApiError("failure", 500, { requestId: "abcdef0123456789" }).requestId).toBe("abcdef0123456789");
    expect(new ApiError("failure", 500, {}, { requestId: "private arbitrary value" }).requestId).toBeUndefined();
  });

  it("records a malformed successful response with the real method and sanitized route", async () => {
    clearDiagnostics();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>private content</html>", {
        headers: { "X-Request-ID": "abcdef0123456789" },
      }),
    );
    await expect(
      requestJson("/api/quantity-sheets/private?token=secret", { method: "PUT", body: "{}" }),
    ).rejects.toMatchObject({
      code: "INVALID_JSON_RESPONSE",
      requestId: "abcdef0123456789",
    });
    expect(captureDiagnostics().events).toContainEqual(
      expect.objectContaining({
        kind: "request",
        method: "PUT",
        route: "/api/quantity-sheets/:id",
        status: 200,
        requestId: "abcdef0123456789",
      }),
    );
    expect(JSON.stringify(captureDiagnostics())).not.toMatch(/private|secret|content/);
  });

  it("preserves body read cancellations even without an explicit signal", async () => {
    const response = new Response("{}");
    vi.spyOn(response, "json").mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(requestJson("/api/users")).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([200, 500])("preserves response body network errors for HTTP %i", async (status) => {
    const response = new Response("{}", { status });
    vi.spyOn(response, "json").mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(requestJson("/api/users")).rejects.toBeInstanceOf(TypeError);
  });

  it("accepts Headers inputs while applying JSON defaults and preserves custom request headers", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await requestJson("/api/users", { method: "POST", body: "{}", headers: new Headers({ "X-Test": "value" }) });
    const init = fetch.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Test")).toBe("value");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("uploads multipart bodies with browser-generated boundaries and preserves cancellation", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"item":{"id":"attachment"}}'));
    const form = new FormData();
    form.set("file", new File(["image"], "example.png"));
    const controller = new AbortController();
    await expect(
      requestMultipart("/api/feedback/item/attachments", form, {
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Test": "kept" },
      }),
    ).resolves.toEqual({ item: { id: "attachment" } });
    const init = fetch.mock.calls[0][1];
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: form, signal: controller.signal });
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
    expect(new Headers(init?.headers).get("X-Test")).toBe("kept");
  });

  it("uses the same structured errors for downloads and uploads", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response('{"error":"denied"}', {
          status: 403,
          headers: { "X-Request-ID": "abcdef0123456789" },
        }),
      ),
    );
    await expect(requestMultipart("/api/feedback/item/attachments", new FormData())).rejects.toMatchObject({
      status: 403,
      code: "HTTP_403",
      requestId: "abcdef0123456789",
    });
    await expect(requestDownload("/api/billing-settlements/xlsx")).rejects.toMatchObject({
      status: 403,
      code: "HTTP_403",
      requestId: "abcdef0123456789",
    });
  });
});
