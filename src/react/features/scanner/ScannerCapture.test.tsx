import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScannerCapture } from "./ScannerCapture";
import type { ScannerSnapshot } from "./frozenQr";

const snapshot: ScannerSnapshot = {
  frame: "data:image/jpeg;base64,original",
  width: 640,
  height: 480,
  focus: {
    image: "data:image/png;base64,corrected",
    size: 512,
    corners: [
      { x: 200, y: 80 },
      { x: 400, y: 100 },
      { x: 390, y: 300 },
      { x: 180, y: 280 },
    ],
  },
};

let reduced = false;
let size = 400;
let resize: () => void;
const listeners = new Set<() => void>();
const disconnect = vi.fn();
const animations: { cancel: ReturnType<typeof vi.fn>; finish: () => void }[] = [];
const animate = vi.fn(() => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cancel = vi.fn();
  animations.push({ cancel, finish });
  return { cancel, finished };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  animations.length = 0;
  listeners.clear();
  reduced = false;
  size = 400;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => listeners.delete(callback),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: size,
    bottom: size,
    width: size,
    height: size,
    toJSON: () => ({}),
  }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

function loadCapture() {
  const result = render(<ScannerCapture snapshot={snapshot} />);
  const corrected = screen.getByRole("img", { name: "已识别笼卡的冻结画面" });
  fireEvent.load(corrected);
  return { ...result, corrected, plane: corrected.parentElement! };
}

function changeMotion(value: boolean) {
  act(() => {
    reduced = value;
    listeners.forEach((callback) => callback());
  });
}

describe("scanner capture presentation lifetime", () => {
  it("keeps the original frame until the corrected pixels load, then completes a finite animation", async () => {
    render(<ScannerCapture snapshot={snapshot} />);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "识别时的原始画面" })).toBeVisible();
    fireEvent.load(screen.getByRole("img", { name: "已识别笼卡的冻结画面" }));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("已定位二维码");
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(screen.getByRole("status")).toHaveTextContent("正在放大校正");
    await act(async () => {
      animations.forEach((animation) => animation.finish());
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("二维码已校正");
  });

  it("shows the corrected result directly when Web Animations are unavailable", () => {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
    const { plane } = loadCapture();
    expect(plane.style.transform).toContain("matrix3d");
    expect(plane.style.visibility).toBe("visible");
    expect(screen.getByRole("status")).toHaveTextContent("二维码已校正");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a partially started animation if the second browser animation throws", () => {
    animate
      .mockImplementationOnce(() => {
        let reject!: (reason: unknown) => void;
        const finished = new Promise<void>((_, fail) => {
          reject = fail;
        });
        const cancel = vi.fn(() => reject(new DOMException("Animation cancelled", "AbortError")));
        animations.push({ cancel, finish: () => undefined });
        return { cancel, finished };
      })
      .mockImplementationOnce(() => {
        throw new Error("animation unavailable");
      });
    const { plane } = loadCapture();
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(plane.style.visibility).toBe("visible");
    expect(screen.getByRole("status")).toHaveTextContent("二维码已校正");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles immediately for reduced motion and never replays when it is disabled", () => {
    reduced = true;
    loadCapture();
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("二维码已校正");
    changeMotion(false);
    expect(animate).not.toHaveBeenCalled();
  });

  it("cancels ongoing movement when reduced motion changes live without replacing the images", () => {
    const { corrected } = loadCapture();
    expect(animate).toHaveBeenCalledTimes(2);
    changeMotion(true);
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(screen.getByRole("img", { name: "已识别笼卡的冻结画面" })).toBe(corrected);
    expect(screen.getByRole("status")).toHaveTextContent("二维码已校正");
    changeMotion(false);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("repositions a resized capture without restarting movement and ignores unchanged measurements", () => {
    const { plane } = loadCapture();
    const originalTransform = plane.style.transform;
    act(() => resize());
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 0)).toBe(true);
    act(() => {
      size = 240;
      resize();
    });
    expect(plane.style.transform).not.toBe(originalTransform);
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("二维码已校正");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses window resize when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { plane } = loadCapture();
    const originalTransform = plane.style.transform;
    act(() => {
      size = 280;
      window.dispatchEvent(new Event("resize"));
    });
    expect(plane.style.transform).not.toBe(originalTransform);
    expect(screen.getByRole("status")).toHaveTextContent("二维码已校正");
  });

  it("cancels animations and pending state changes when leaving the scanner", async () => {
    const { unmount } = loadCapture();
    unmount();
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      animations.forEach((animation) => animation.finish());
      await Promise.resolve();
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("keeps the unmodified frame if the corrected image cannot load", () => {
    render(<ScannerCapture snapshot={snapshot} />);
    fireEvent.error(screen.getByRole("img", { name: "已识别笼卡的冻结画面" }));
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute("src", snapshot.frame);
    expect(screen.getByRole("img")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("已识别，画面已冻结");
    expect(animate).not.toHaveBeenCalled();
  });

  it("restores the original frame if the texture becomes unavailable after alignment started", () => {
    const { corrected } = loadCapture();
    fireEvent.error(corrected);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute("src", snapshot.frame);
    expect(screen.getByRole("img")).toBeVisible();
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("已识别，画面已冻结");
  });
});
