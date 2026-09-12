import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QRCode } from "../../../vendor/jsQR";
import type { QrWorkerRequest, QrWorkerResponse } from "./qrScanner.worker";
import { useCameraScanner } from "./useCameraScanner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class TestImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

class CameraWorker {
  static instances: CameraWorker[] = [];
  onmessage: ((event: MessageEvent<QrWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<(request: QrWorkerRequest, transfer: Transferable[]) => void>();
  terminate = vi.fn();
  constructor() {
    CameraWorker.instances.push(this);
  }
  respond(results: QRCode[] = [], complete = true, changes: Partial<QrWorkerResponse> = {}) {
    const request = this.postMessage.mock.lastCall?.[0];
    if (!request) throw new Error("No camera frame was submitted");
    this.onmessage?.({
      data: { ...request, results, complete, scans: 1, ...changes },
    } as MessageEvent<QrWorkerResponse>);
  }
}

const stop = vi.fn();
const stream = { getTracks: () => [{ stop }] };
const getUserMedia = vi.fn(() => Promise.resolve(stream));
const play = vi.fn(() => Promise.resolve());
const drawImage = vi.fn();
const putImageData = vi.fn();
const readPixels = vi.fn((_x: number, _y: number, width: number, height: number) => ({
  data: new Uint8ClampedArray(width * height * 4).fill(37),
  width,
  height,
}));
const canvasContextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

beforeEach(() => {
  vi.clearAllMocks();
  CameraWorker.instances.length = 0;
  frames.clear();
  nextFrame = 0;
  getUserMedia.mockResolvedValue(stream);
  play.mockResolvedValue();
  vi.stubGlobal("Worker", CameraWorker);
  vi.stubGlobal("ImageData", TestImageData);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,frozen");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ drawImage, getImageData: readPixels, putImageData }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (canvasContextDescriptor)
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasContextDescriptor);
});

function videoElement(width = 100, height = 100) {
  const video = document.createElement("video");
  Object.defineProperties(video, {
    readyState: { value: 4 },
    videoWidth: { value: width },
    videoHeight: { value: height },
  });
  return video;
}
function setup(width = 100, height = 100) {
  const onCode = vi.fn();
  const hook = renderHook(() => useCameraScanner(onCode));
  const video = videoElement(width, height);
  hook.result.current.videoRef.current = video;
  return { ...hook, video, onCode };
}
function frame(timestamp: number) {
  const queued = [...frames];
  frames.clear();
  queued.forEach(([, callback]) => callback(timestamp));
}
function worker() {
  return CameraWorker.instances.at(-1)!;
}
function locatedCode(data: string, x: number): QRCode {
  return {
    data,
    location: {
      topLeftCorner: { x, y: 10 },
      topRightCorner: { x: x + 20, y: 10 },
      bottomRightCorner: { x: x + 20, y: 30 },
      bottomLeftCorner: { x, y: 30 },
    },
  };
}

describe("camera scanner lifetime", () => {
  it("uses the latest lookup callback when the worker finishes", async () => {
    const original = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(({ callback }) => useCameraScanner(callback), {
      initialProps: { callback: original },
    });
    result.current.videoRef.current = videoElement();
    await act(async () => result.current.toggle());
    act(() => frame(0));
    rerender({ callback: latest });
    act(() => worker().respond([{ data: "AB12" }]));
    expect(original).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith("AB12");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("automatically opens a confirmed single code only once and releases the camera and worker", async () => {
    const { result, video, onCode } = setup(3840, 2160);
    await act(async () => result.current.toggle());
    act(() => frame(0));
    const decoder = worker();
    act(() => {
      decoder.respond([{ data: "AB12" }]);
      decoder.respond([{ data: "AB12" }]);
      frame(100);
    });
    expect(decoder.postMessage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    expect(onCode).toHaveBeenCalledExactlyOnceWith("AB12");
    expect(result.current.snapshot).toEqual({
      frame: "data:image/jpeg;base64,frozen",
      width: 1280,
      height: 720,
      focus: null,
    });
    expect(result.current.active).toBe(false);
    expect(result.current.choosing).toBe(false);
    expect(result.current.selectionId).toBe(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(decoder.terminate).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    await act(async () => result.current.toggle());
    expect(result.current.snapshot).toBeNull();
    expect(result.current.active).toBe(true);
  });

  it("restores the exact returned frame instead of capturing another live camera image", async () => {
    const { result } = setup(80, 60);
    await act(async () => result.current.toggle());
    act(() => frame(0));
    const originalPixels = new Uint8ClampedArray(80 * 60 * 4).fill(91);
    act(() => worker().respond([{ data: "AB12" }], true, { pixels: originalPixels }));
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(putImageData).toHaveBeenCalledTimes(1);
    const restored = putImageData.mock.calls[0][0] as ImageData;
    expect(restored.width).toBe(80);
    expect(restored.height).toBe(60);
    expect(restored.data).toEqual(originalPixels);
    expect(restored.data).not.toBe(readPixels.mock.results[0].value.data);
    const [request, transfer] = worker().postMessage.mock.calls[0];
    expect(transfer).toEqual([request.pixels.buffer]);
  });

  it.each(["image export", "frame restoration"])(
    "still queries and releases resources when optional %s fails",
    async (failure) => {
      if (failure === "image export") {
        vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
          throw new Error("capture failed");
        });
      } else {
        putImageData.mockImplementationOnce(() => {
          throw new Error("canvas unavailable");
        });
      }
      const { result, onCode } = setup();
      await act(async () => result.current.toggle());
      act(() => {
        frame(0);
        worker().respond([{ data: "AB12" }]);
      });
      expect(onCode).toHaveBeenCalledExactlyOnceWith("AB12");
      expect(stop).toHaveBeenCalledTimes(1);
      expect(result.current.snapshot).toBeNull();
      expect(result.current.active).toBe(false);
      expect(result.current.pending).toBe(false);
      expect(result.current.error).toBe("");
    },
  );

  it("requests permission only once and stops a stream arriving after unmount", async () => {
    const permission = deferred<typeof stream>();
    getUserMedia.mockReturnValue(permission.promise);
    const { result, unmount } = setup();
    let start: Promise<void>;
    act(() => {
      start = result.current.toggle();
      void result.current.toggle();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    unmount();
    await act(async () => {
      permission.resolve(stream);
      await start;
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    expect(CameraWorker.instances).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it("keeps one frame in flight and caps subsequent work at ten frames per second", async () => {
    const { result, video } = setup();
    await act(async () => result.current.toggle());
    expect(video.srcObject).toBe(stream);
    act(() => {
      frame(0);
      for (const timestamp of [16, 32, 64, 100, 1000]) frame(timestamp);
    });
    expect(readPixels).toHaveBeenCalledTimes(1);
    expect(worker().postMessage).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    act(() => {
      worker().respond();
      for (const timestamp of [16, 32, 64]) frame(timestamp);
    });
    expect(readPixels).toHaveBeenCalledTimes(1);
    act(() => frame(100));
    expect(readPixels).toHaveBeenCalledTimes(2);
    await act(async () => result.current.toggle());
    expect(result.current.active).toBe(false);
    expect(video.srcObject).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("ignores pending worker results after stopping or navigating away", async () => {
    const { result, onCode, unmount } = setup();
    await act(async () => result.current.toggle());
    act(() => frame(0));
    const stoppedWorker = worker();
    await act(async () => result.current.toggle());
    act(() => stoppedWorker.respond([{ data: "AB12" }]));
    expect(onCode).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
    await act(async () => result.current.toggle());
    act(() => frame(100));
    const unmountedWorker = worker();
    unmount();
    act(() => unmountedWorker.respond([{ data: "CD34" }]));
    expect(onCode).not.toHaveBeenCalled();
    expect(unmountedWorker.terminate).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("releases a failed video and lets the user retry", async () => {
    play.mockRejectedValueOnce(new Error("播放失败"));
    const { result } = setup();
    await act(async () => result.current.toggle());
    expect(result.current.error).toBe("播放失败");
    expect(result.current.pending).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => result.current.toggle());
    expect(result.current.error).toBe("");
    expect(result.current.active).toBe(true);
  });

  it("never starts a worker if navigation happens while video playback is pending", async () => {
    const playback = deferred<void>();
    play.mockReturnValue(playback.promise);
    const { result, unmount } = setup();
    let start: Promise<void>;
    await act(async () => {
      start = result.current.toggle();
      await Promise.resolve();
    });
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => {
      playback.resolve();
      await start;
    });
    expect(CameraWorker.instances).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it("provides a manual-entry fallback if workers are unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    const { result, onCode } = setup();
    await act(async () => result.current.toggle());
    expect(result.current.error).toContain("请输入识别码查询");
    expect(result.current.active).toBe(false);
    expect(result.current.pending).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onCode).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it.each(["load error", "decoder error"])("cleans up a worker %s and supports retry", async (failure) => {
    const { result, onCode } = setup();
    await act(async () => result.current.toggle());
    act(() => frame(0));
    const failedWorker = worker();
    act(() => {
      if (failure === "load error") {
        const preventDefault = vi.fn();
        failedWorker.onerror?.({ preventDefault } as unknown as ErrorEvent);
        expect(preventDefault).toHaveBeenCalledOnce();
      } else {
        failedWorker.respond([], false, { error: "二维码识别失败，请重试" });
      }
      failedWorker.respond([{ data: "AB12" }]);
    });
    expect(result.current.error).toContain("请重试");
    expect(result.current.active).toBe(false);
    expect(result.current.pending).toBe(false);
    expect(onCode).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(failedWorker.terminate).toHaveBeenCalledOnce();
    await act(async () => result.current.toggle());
    expect(result.current.error).toBe("");
    expect(result.current.active).toBe(true);
    expect(worker()).not.toBe(failedWorker);
  });
});

describe("camera multi-code selection", () => {
  it("waits for a deliberate choice, queries once per choice, and allows another code from the same frame", async () => {
    const { result, video, onCode } = setup();
    await act(async () => result.current.toggle());
    const codes = [locatedCode("AB12", 10), locatedCode("CD34", 60)];
    act(() => {
      frame(0);
      worker().respond(codes);
    });
    expect(onCode).not.toHaveBeenCalled();
    expect(result.current.choosing).toBe(true);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.choices?.candidates).toHaveLength(2);
    expect(result.current.choices?.candidates[1].code.data).toBe("CD34");
    expect(result.current.choices?.candidates[1].corners?.[0]).toEqual({ x: 60, y: 10 });
    expect(stop).toHaveBeenCalledOnce();
    expect(worker().terminate).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    act(() => {
      result.current.selectCandidate(1);
      result.current.selectCandidate(0);
    });
    expect(onCode).toHaveBeenCalledExactlyOnceWith("CD34");
    expect(result.current.choosing).toBe(false);
    expect(result.current.snapshot?.focus?.corners[0]).toEqual({ x: 60, y: 10 });
    expect(result.current.selectionId).toBe(1);
    act(() => result.current.reopenChoices());
    expect(result.current.choosing).toBe(true);
    expect(result.current.snapshot).toBeNull();
    expect(onCode).toHaveBeenCalledOnce();
    act(() => result.current.selectCandidate(0));
    expect(onCode.mock.calls).toEqual([["CD34"], ["AB12"]]);
    expect(result.current.selectionId).toBe(2);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it("does not auto-query an incomplete scan even when it found only one code", async () => {
    const { result, onCode } = setup();
    await act(async () => result.current.toggle());
    act(() => {
      frame(0);
      worker().respond([{ data: "AB12" }], false);
    });
    expect(onCode).not.toHaveBeenCalled();
    expect(result.current.choosing).toBe(true);
    expect(result.current.choices?.complete).toBe(false);
    act(() => result.current.selectCandidate(0));
    expect(onCode).toHaveBeenCalledExactlyOnceWith("AB12");
  });

  it("allows numbered choices even when frozen image creation fails", async () => {
    putImageData.mockImplementationOnce(() => {
      throw new Error("No image canvas");
    });
    const { result, onCode } = setup();
    await act(async () => result.current.toggle());
    act(() => {
      frame(0);
      worker().respond([{ data: "AB12" }, { data: "CD34" }]);
    });
    expect(result.current.choices?.frame).toBe("");
    expect(result.current.choosing).toBe(true);
    act(() => result.current.selectCandidate(1));
    expect(onCode).toHaveBeenCalledExactlyOnceWith("CD34");
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBe("");
  });

  it("uses a refreshed lookup callback while choosing from a frozen frame", async () => {
    const original = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(({ callback }) => useCameraScanner(callback), {
      initialProps: { callback: original },
    });
    result.current.videoRef.current = videoElement();
    await act(async () => result.current.toggle());
    act(() => {
      frame(0);
      worker().respond([{ data: "AB12" }, { data: "CD34" }]);
    });
    rerender({ callback: latest });
    act(() => result.current.selectCandidate(1));
    expect(original).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith("CD34");
  });

  it("clears choices on continuing and discards the previous worker response", async () => {
    const { result, onCode } = setup();
    await act(async () => result.current.toggle());
    act(() => {
      frame(0);
      worker().respond([{ data: "AB12" }, { data: "CD34" }]);
    });
    const previous = worker();
    await act(async () => result.current.toggle());
    expect(result.current.choices).toBeNull();
    expect(result.current.choosing).toBe(false);
    expect(result.current.snapshot).toBeNull();
    act(() => {
      result.current.selectCandidate(0);
      result.current.reopenChoices();
      previous.respond([{ data: "OLD1" }]);
      frame(100);
      worker().respond([{ data: "NEW1" }]);
    });
    expect(onCode).toHaveBeenCalledExactlyOnceWith("NEW1");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("ignores invalid indices and clears retained choices when leaving the scanner", async () => {
    const { result, unmount, onCode } = setup();
    await act(async () => result.current.toggle());
    act(() => {
      frame(0);
      worker().respond([{ data: "AB12" }, { data: "CD34" }]);
      result.current.selectCandidate(-1);
      result.current.selectCandidate(2);
    });
    expect(onCode).not.toHaveBeenCalled();
    expect(result.current.choosing).toBe(true);
    const select = result.current.selectCandidate;
    const reopen = result.current.reopenChoices;
    unmount();
    act(() => {
      reopen();
      select(0);
    });
    expect(onCode).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
});
