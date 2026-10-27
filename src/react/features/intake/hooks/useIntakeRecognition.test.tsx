import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIntakeRecognition } from "./useIntakeRecognition";

describe("intake recognition images", () => {
  it("adds and removes images, rejects invalid input without losing previous images", async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useIntakeRecognition(onChange));
    await act(async () => {
      await result.current.addFiles([new File(["png"], "one.png", { type: "image/png" })]);
    });
    expect(result.current.images).toHaveLength(1);
    await act(async () => {
      await result.current.addFiles([new File(["svg"], "unsafe.svg", { type: "image/svg+xml" })]);
    });
    expect(result.current.images).toHaveLength(1);
    expect(result.current.error).toContain("PNG");
    act(() => result.current.remove(result.current.images[0].key));
    expect(result.current.images).toHaveLength(0);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
  it("aborts and invalidates a request after a draft change while retaining images", async () => {
    const { result } = renderHook(() => useIntakeRecognition(() => {}));
    await act(async () => {
      await result.current.addFiles([new File(["png"], "one.png", { type: "image/png" })]);
    });
    let request: ReturnType<typeof result.current.begin> = null;
    act(() => {
      request = result.current.begin();
    });
    expect(request!.isCurrent()).toBe(true);
    act(() => result.current.invalidate());
    expect(request!.signal.aborted).toBe(true);
    expect(request!.isCurrent()).toBe(false);
    expect(result.current.images).toHaveLength(1);
  });
});

it("keeps both batches when images are added before earlier reads finish", async () => {
  const readers: FileReader[] = [];
  class DeferredReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      readers.push(this as unknown as FileReader);
    }
  }
  vi.stubGlobal("FileReader", DeferredReader);
  try {
    const { result } = renderHook(() => useIntakeRecognition(() => {}));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.addFiles([new File(["one"], "one.png", { type: "image/png" })]);
      second = result.current.addFiles([new File(["two"], "two.png", { type: "image/png" })]);
    });
    expect(result.current.reading).toBe(true);
    await act(async () => {
      Object.defineProperty(readers[1], "result", { value: "data:image/png;base64,dHdv" });
      (readers[1].onload as (() => void) | null)?.();
      await second;
    });
    expect(result.current.reading).toBe(true);
    await act(async () => {
      Object.defineProperty(readers[0], "result", { value: "data:image/png;base64,b25l" });
      (readers[0].onload as (() => void) | null)?.();
      await first;
    });
    expect(result.current.reading).toBe(false);
    expect(result.current.images.map((image) => image.name).sort()).toEqual(["one.png", "two.png"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("ignores a late file read after reset and does not apply a stale recognition request", async () => {
  const readers: FileReader[] = [];
  class DeferredReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    readAsDataURL() {
      readers.push(this as unknown as FileReader);
    }
  }
  vi.stubGlobal("FileReader", DeferredReader);
  try {
    const { result } = renderHook(() => useIntakeRecognition(() => {}));
    let load: Promise<void> = Promise.resolve();
    let request: ReturnType<typeof result.current.begin> = null;
    act(() => {
      request = result.current.begin();
      load = result.current.addFiles([new File(["x"], "x.png", { type: "image/png" })]);
    });
    expect(request!.isCurrent()).toBe(false);
    act(() => result.current.reset());
    await act(async () => {
      Object.defineProperty(readers[0], "result", { value: "data:image/png;base64,eA==" });
      (readers[0].onload as (() => void) | null)?.();
      await load;
    });
    expect(result.current.images).toHaveLength(0);
    expect(result.current.reading).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
