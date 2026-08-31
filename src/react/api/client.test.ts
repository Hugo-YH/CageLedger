import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJson } from "./client";

describe("requestJson", () => {
  afterEach(() => vi.restoreAllMocks());

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

  it("preserves the legacy empty response fallback when not cancelled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await expect(requestJson("/api/health")).resolves.toEqual({});
  });
});
