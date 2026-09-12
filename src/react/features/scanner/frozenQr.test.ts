import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureQr } from "./frozenQr";

const location = {
  topLeftCorner: { x: 0, y: 0 },
  topRightCorner: { x: 2, y: 0 },
  bottomRightCorner: { x: 2, y: 2 },
  bottomLeftCorner: { x: 0, y: 2 },
};
const pixels = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]),
} as ImageData;
const putImageData = vi.fn();
const exportImage = vi.fn((type?: string) => `data:${type};base64,pixels`);
const canvasContextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");

beforeEach(() => {
  vi.clearAllMocks();
  putImageData.mockReset();
  exportImage.mockImplementation((type) => `data:${type};base64,pixels`);
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ putImageData }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(exportImage);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (canvasContextDescriptor)
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasContextDescriptor);
});

function canvas() {
  const result = document.createElement("canvas");
  result.width = result.height = 2;
  return result;
}

describe("optional frozen QR pixels", () => {
  it("retains the original frame and builds an independent corrected pixel texture", () => {
    const result = captureQr(canvas(), pixels, location);
    expect(result?.frame).toBe("data:image/jpeg;base64,pixels");
    expect(result?.focus?.image).toBe("data:image/png;base64,pixels");
    expect(result?.focus?.corners[0]).toEqual(location.topLeftCorner);
    expect(result?.focus?.corners[0]).not.toBe(location.topLeftCorner);
    const texture = putImageData.mock.calls[0][0] as ImageData;
    expect(texture.width).toBe(result?.focus?.size);
    expect(texture.height).toBe(texture.width);
    expect(texture.data).not.toBe(pixels.data);
    expect(texture.data[0]).toBeLessThan(10);
    expect(texture.data[(texture.width - 1) * 4]).toBeGreaterThan(245);
  });

  it("keeps the original frame without a fabricated highlight for missing or invalid corners", () => {
    for (const invalid of [undefined, {}, { ...location, topLeftCorner: { x: -1, y: 0 } }]) {
      expect(captureQr(canvas(), pixels, invalid)).toEqual({
        frame: "data:image/jpeg;base64,pixels",
        width: 2,
        height: 2,
        focus: null,
      });
    }
    expect(putImageData).not.toHaveBeenCalled();
  });

  it("retains the original frame when drawing the corrected pixels fails", () => {
    putImageData.mockImplementation(() => {
      throw new Error("pixel upload failed");
    });
    const result = captureQr(canvas(), pixels, location);
    expect(result?.frame).toBe("data:image/jpeg;base64,pixels");
    expect(result?.focus).toBeNull();
  });

  it("retains the original frame if a separate texture canvas is unavailable", () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
    const result = captureQr(canvas(), pixels, location);
    expect(result?.frame).toBe("data:image/jpeg;base64,pixels");
    expect(result?.focus).toBeNull();
    expect(putImageData).not.toHaveBeenCalled();
  });

  it("retains the original frame when exporting the corrected texture fails", () => {
    exportImage.mockImplementation((type) => {
      if (type === "image/png") throw new Error("texture export failed");
      return "data:image/jpeg;base64,pixels";
    });
    const result = captureQr(canvas(), pixels, location);
    expect(result?.frame).toBe("data:image/jpeg;base64,pixels");
    expect(result?.focus).toBeNull();
  });

  it("returns no presentation rather than throwing if the original frame cannot be exported", () => {
    exportImage.mockImplementation(() => {
      throw new Error("frame export failed");
    });
    expect(captureQr(canvas(), pixels, location)).toBeNull();
    expect(putImageData).not.toHaveBeenCalled();
  });
});
