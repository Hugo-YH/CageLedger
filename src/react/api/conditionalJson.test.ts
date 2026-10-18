import { afterEach, describe, expect, it, vi } from "vitest";

import { requestConditionalJson } from "./client";
import { captureDiagnostics, clearDiagnostics } from "../diagnostics/collector";

describe("conditional JSON reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearDiagnostics();
  });

  it("retains the validator with Query-owned data and reuses it on 304", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"amount":123.45}', { headers: { ETag: 'W/"one"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const first = await requestConditionalJson("/api/dashboard/overview");
    expect(first).toEqual({ value: { amount: 123.45 }, etag: 'W/"one"' });
    const second = await requestConditionalJson("/api/dashboard/overview", first);
    expect(second).toBe(first);
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("If-None-Match")).toBe('W/"one"');
    expect(captureDiagnostics().events.filter((event) => event.kind === "request")).toEqual([]);
  });

  it("supports older servers without validators and updates changed data", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"amount":0}'))
      .mockResolvedValueOnce(new Response('{"amount":0.01}'));
    const first = await requestConditionalJson("/api/dashboard/overview");
    expect(await requestConditionalJson("/api/dashboard/overview", first)).toEqual({
      value: { amount: 0.01 },
      etag: "",
    });
    expect(new Headers(fetch.mock.calls[1][1]?.headers).has("If-None-Match")).toBe(false);
  });

  it("preserves API errors instead of returning stale data as success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"error":"denied"}', { status: 403 }));
    await expect(requestConditionalJson("/api/dashboard/overview", { value: {}, etag: '"old"' })).rejects.toMatchObject(
      {
        status: 403,
        message: "denied",
      },
    );
  });

  it("rejects an unsolicited 304 and an aborted cached response", async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));
    await expect(requestConditionalJson("/api/dashboard/overview")).rejects.toMatchObject({
      code: "INVALID_NOT_MODIFIED_RESPONSE",
    });
    fetch.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(new Response(null, { status: 304 }));
    });
    await expect(
      requestConditionalJson("/api/dashboard/overview", { value: {}, etag: '"old"' }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
