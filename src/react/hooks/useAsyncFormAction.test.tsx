import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAsyncFormAction } from "./useAsyncFormAction";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("useAsyncFormAction", () => {
  it("blocks duplicate submissions, including while validating fields", async () => {
    const pending = deferred<number>();
    const action = vi.fn(() => pending.promise);
    const success = vi.fn();
    const { result } = renderHook(() => useAsyncFormAction("保存失败"));
    let run: Promise<void> | undefined;
    act(() => {
      run = result.current.run(action, success);
      void result.current.run(action, success);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    await act(async () => {
      pending.resolve(7);
      await run;
    });
    expect(success).toHaveBeenCalledExactlyOnceWith(7);
    expect(result.current.pending).toBe(false);
  });

  it("shows request errors and clears them when retry succeeds", async () => {
    const { result } = renderHook(() => useAsyncFormAction("保存失败"));
    await act(() => result.current.run(vi.fn().mockRejectedValue(new Error("没有写入权限"))));
    expect(result.current.error).toBe("没有写入权限");
    expect(result.current.pending).toBe(false);
    await act(() => result.current.run(() => Promise.resolve(1)));
    expect(result.current.error).toBe("");
  });

  it("leaves field validation errors to Form and never calls success", async () => {
    const success = vi.fn();
    const { result } = renderHook(() => useAsyncFormAction("保存失败"));
    await act(() =>
      result.current.run(vi.fn().mockRejectedValue({ errorFields: [{ name: ["amount"], errors: ["必填"] }] }), success),
    );
    expect(result.current.error).toBe("");
    expect(success).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("does not swallow unknown non-Error failures", async () => {
    const { result } = renderHook(() => useAsyncFormAction("保存失败"));
    await act(() => result.current.run(vi.fn().mockRejectedValue({})));
    expect(result.current.error).toBe("保存失败");
  });

  it("does not close a new form when a request from the closed form completes", async () => {
    const pending = deferred<string>();
    const success = vi.fn();
    const { result, unmount } = renderHook(() => useAsyncFormAction("保存失败"));
    let run: Promise<void> | undefined;
    act(() => {
      run = result.current.run(() => pending.promise, success);
    });
    unmount();
    await act(async () => {
      pending.resolve("old");
      await run;
    });
    expect(success).not.toHaveBeenCalled();
  });
});
