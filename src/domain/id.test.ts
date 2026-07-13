import { afterEach, describe, expect, it, vi } from "vitest";

import { createClientId } from "./id";

describe("createClientId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the platform UUID API when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "platform-id" });

    expect(createClientId()).toBe("platform-id");
  });

  it("creates distinct draft IDs when private HTTP omits randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: (values: Uint32Array) => values.fill(1) });

    const first = createClientId();
    const second = createClientId();

    expect(first).toMatch(/^[0-9a-f-]+$/);
    expect(second).toMatch(/^[0-9a-f-]+$/);
    expect(second).not.toBe(first);
  });
});
