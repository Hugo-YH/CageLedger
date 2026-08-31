import { StrictMode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useLatestRequest } from "./useLatestRequest";

afterEach(cleanup);

describe("useLatestRequest", () => {
  it("allows only the latest request to apply a result", () => {
    const { result } = renderHook(useLatestRequest);
    const first = result.current.begin();
    const second = result.current.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("invalidates results when the input changes or the form closes", () => {
    const { result } = renderHook(useLatestRequest);
    const current = result.current.begin();
    result.current.invalidate();
    expect(current()).toBe(false);
    expect(result.current.begin()()).toBe(true);
  });

  it("keeps its API stable and invalidates on unmount, including Strict Mode", () => {
    const { result, rerender, unmount } = renderHook(useLatestRequest, { wrapper: StrictMode });
    const api = result.current;
    const current = api.begin();
    rerender();
    expect(result.current).toBe(api);
    expect(current()).toBe(true);
    unmount();
    expect(current()).toBe(false);
  });
});
