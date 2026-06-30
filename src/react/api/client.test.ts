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
});
