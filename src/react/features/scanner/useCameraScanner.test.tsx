import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCameraScanner } from "./useCameraScanner";

const { decode, decoderExports } = vi.hoisted(() => {
  const decode = vi.fn();
  const decoderExports: { default?: typeof decode } = { default: decode };
  return { decode, decoderExports };
});
vi.mock("../../../vendor/jsQR.js", () => decoderExports);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const stop = vi.fn();
const stream = { getTracks: () => [{ stop }] };
const getUserMedia = vi.fn(() => Promise.resolve(stream));
const play = vi.fn(() => Promise.resolve());
const drawImage = vi.fn();
const readPixels = vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }));
const canvasContextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
let frame: FrameRequestCallback;

beforeEach(() => {
  vi.clearAllMocks();
  getUserMedia.mockResolvedValue(stream);
  play.mockResolvedValue();
  decode.mockReturnValue(null);
  decoderExports.default = decode;
  vi.stubGlobal("jsQR", undefined);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,frozen");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ drawImage, getImageData: readPixels }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (canvasContextDescriptor)
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasContextDescriptor);
});

function setup(width = 1, height = 1) {
  const onCode = vi.fn();
  const hook = renderHook(() => useCameraScanner(onCode));
  const video = document.createElement("video");
  Object.defineProperties(video, {
    readyState: { value: 4 },
    videoWidth: { value: width },
    videoHeight: { value: height },
  });
  hook.result.current.videoRef.current = video;
  return { ...hook, video, onCode };
}

describe("camera scanner lifetime", () => {
  it("decodes the production module export, freezes once, and releases the camera", async () => {
    decode.mockReturnValue({ data: "AB12" });
    const { result, video, onCode } = setup(3840, 2160);
    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      frame(0);
      frame(100);
    });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    expect(onCode).toHaveBeenCalledExactlyOnceWith("AB12");
    expect(result.current.snapshot).toBe("data:image/jpeg;base64,frozen");
    expect(result.current.active).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.snapshot).toBe("");
    expect(result.current.active).toBe(true);
  });

  it("supports the development global and reports a missing decoder instead of silently scanning", async () => {
    decoderExports.default = undefined;
    const { result } = setup();
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.error).toContain("识别器加载失败");
    expect(result.current.active).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    vi.stubGlobal("jsQR", decode);
    await act(async () => {
      await result.current.toggle();
    });
    act(() => frame(0));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(true);
  });

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
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("attaches the video, caps decoding at ten frames per second, and releases on stop", async () => {
    const { result, video } = setup();
    await act(async () => {
      await result.current.toggle();
    });
    expect(video.srcObject).toBe(stream);
    expect(result.current.active).toBe(true);
    act(() => {
      for (const timestamp of [0, 16, 32, 64, 100]) frame(timestamp);
    });
    expect(readPixels).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.active).toBe(false);
    expect(video.srcObject).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("releases a failed video and lets the user retry", async () => {
    play.mockRejectedValueOnce(new Error("播放失败"));
    const { result } = setup();
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.error).toBe("播放失败");
    expect(result.current.pending).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.error).toBe("");
    expect(result.current.active).toBe(true);
  });

  it("never starts decoding if navigation happens while video playback is pending", async () => {
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
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
