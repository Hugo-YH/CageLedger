import { describe, expect, it } from "vitest";
import * as bundledDecoder from "../../../vendor/jsQR.js";
import { qrCodeMatrix } from "../../print/qrCode";
import { scanQrFrame, type QrDecoder } from "./multiQr";
import { getQrCorners } from "./qrGeometry";

const decode: QrDecoder = typeof bundledDecoder.default === "function" ? bundledDecoder.default : window.jsQR!;

interface FixtureCode {
  value: string;
  left: number;
  top: number;
  module?: number;
  rotation?: number;
  perspective?: number;
}

/** Independent inverse camera projection of real QR modules, including a quiet zone. */
function frame(width: number, height: number, codes: FixtureCode[]) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const code of codes) {
    const matrix = qrCodeMatrix(code.value);
    const module = code.module ?? 6;
    const quiet = 4;
    const cosine = Math.cos(code.rotation ?? 0);
    const sine = Math.sin(code.rotation ?? 0);
    const perspective = code.perspective ?? 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x + 0.5 - code.left;
        const dy = y + 0.5 - code.top;
        const projectedX = dx * cosine + dy * sine;
        const projectedY = -dx * sine + dy * cosine;
        const denominator = 1 - perspective * projectedY;
        if (denominator <= 0) continue;
        const row = Math.floor(projectedY / denominator / module) - quiet;
        const col = Math.floor(projectedX / denominator / module) - quiet;
        if (matrix[row]?.[col]) pixels.set([0, 0, 0, 255], (y * width + x) * 4);
      }
    }
  }
  return { pixels, width, height };
}

function scan(fixture: ReturnType<typeof frame>) {
  return scanQrFrame(fixture.pixels, fixture.width, fixture.height, decode, { deadlineMs: 5000 });
}

describe("same-frame multiple QR decoding", () => {
  it("reads a single real code once and preserves its original pixels and measured corners", () => {
    const fixture = frame(360, 300, [{ value: "AB12", left: 60, top: 50 }]);
    const original = fixture.pixels.slice();
    const result = scan(fixture);
    expect(result.complete).toBe(true);
    expect(result.results.map((code) => code.data)).toEqual(["AB12"]);
    expect(fixture.pixels).toEqual(original);
    const corners = getQrCorners(result.results[0].location, fixture.width, fixture.height)!;
    expect(corners[0].x).toBeCloseTo(84, 0);
    expect(corners[0].y).toBeCloseTo(74, 0);
    expect(corners[2].x).toBeCloseTo(210, 0);
    expect(corners[2].y).toBeCloseTo(200, 0);
  });

  it.each([
    [
      "side by side",
      640,
      320,
      [
        { value: "AB12", left: 30, top: 40 },
        { value: "CD34", left: 370, top: 60 },
      ],
    ],
    [
      "stacked",
      320,
      640,
      [
        { value: "AB12", left: 40, top: 20 },
        { value: "CD34", left: 70, top: 390 },
      ],
    ],
    [
      "four cages",
      700,
      650,
      [
        { value: "AB12", left: 30, top: 20 },
        { value: "CD34", left: 370, top: 20 },
        { value: "EF56", left: 30, top: 360 },
        { value: "GH78", left: 370, top: 360 },
      ],
    ],
  ] as const)("finds every readable real code when %s", (_, width, height, codes) => {
    const fixture = frame(width, height, [...codes]);
    const result = scan(fixture);
    expect(result.complete).toBe(true);
    expect(result.results.map((code) => code.data).sort()).toEqual(codes.map((code) => code.value).sort());
    for (const code of result.results) {
      const source = codes.find((candidate) => candidate.value === code.data)!;
      const corners = getQrCorners(code.location, width, height)!;
      expect(corners[0].x).toBeCloseTo(source.left + 24, 0);
      expect(corners[0].y).toBeCloseTo(source.top + 24, 0);
    }
  });

  it("retains identical contents at different positions as separate choices", () => {
    const fixture = frame(640, 320, [
      { value: "AB12", left: 20, top: 60 },
      { value: "AB12", left: 380, top: 60 },
    ]);
    const result = scan(fixture);
    expect(result.complete).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.map((code) => code.data)).toEqual(["AB12", "AB12"]);
    const x = result.results.map((code) => code.location!.topLeftCorner.x).sort((a, b) => a - b);
    expect(x[1] - x[0]).toBeCloseTo(360, 0);
  });

  it("completes four URL cards in a camera-sized frame, including a duplicate print", () => {
    const fixture = frame(960, 720, [
      { value: "https://example.test/c/AB12", left: 65, top: 40, module: 7 },
      { value: "https://example.test/c/CD34", left: 535, top: 40, module: 7 },
      { value: "https://example.test/c/EF56", left: 65, top: 400, module: 7 },
      { value: "https://example.test/c/AB12", left: 535, top: 400, module: 7 },
    ]);
    const result = scanQrFrame(fixture.pixels, fixture.width, fixture.height, decode);
    expect(result.complete).toBe(true);
    expect(result.results.map((code) => code.data.slice(-4)).sort()).toEqual(["AB12", "AB12", "CD34", "EF56"]);
    expect(result.results.every((code) => getQrCorners(code.location, 960, 720))).toBe(true);
  });

  it("finds a rotated perspective code and a neighboring edge code", () => {
    const fixture = frame(640, 360, [
      { value: "https://example.test/c/AB12", left: 85, top: 55, module: 6, rotation: 0.33, perspective: 0.0012 },
      { value: "CD34", left: 478, top: 130 },
    ]);
    const result = scan(fixture);
    expect(result.complete).toBe(true);
    expect(result.results.map((code) => code.data).sort()).toEqual(["CD34", "https://example.test/c/AB12"]);
    const corners = getQrCorners(result.results.find((code) => code.data.endsWith("AB12"))!.location, 640, 360)!;
    // The decoder must retain the slanted real geometry, rather than boxing or re-generating the QR.
    expect(corners[1].y - corners[0].y).toBeGreaterThan(30);
    expect(corners[2].x - corners[3].x).toBeLessThan(corners[1].x - corners[0].x);
  });

  it("finishes a blank frame without inventing candidates", () => {
    const result = scan(frame(640, 360, []));
    expect(result).toEqual({ results: [], complete: true, scans: 0 });
  });

  it("marks scan and result limits incomplete even after a code was found", () => {
    const fixture = frame(360, 300, [{ value: "AB12", left: 60, top: 50 }]);
    const limited = scanQrFrame(fixture.pixels, fixture.width, fixture.height, decode, { maxScans: 1 });
    expect(limited.results).toHaveLength(1);
    expect(limited.complete).toBe(false);
    expect(limited.reason).toBe("budget");
    const capped = scanQrFrame(fixture.pixels, fixture.width, fixture.height, decode, { maxResults: 1 });
    expect(capped.results).toHaveLength(1);
    expect(capped.complete).toBe(false);
    expect(capped.reason).toBe("limit");
  });

  it("stops between decoder calls when cancelled or out of wall-clock budget", () => {
    const fixture = frame(360, 300, [{ value: "AB12", left: 60, top: 50 }]);
    let cancelled = false;
    const result = scanQrFrame(
      fixture.pixels,
      fixture.width,
      fixture.height,
      (pixels, width, height) => {
        const code = decode(pixels, width, height);
        cancelled = true;
        return code;
      },
      { isCancelled: () => cancelled },
    );
    expect(result).toMatchObject({ complete: false, reason: "cancelled", scans: 1 });
    let time = 0;
    const timed = scanQrFrame(fixture.pixels, fixture.width, fixture.height, decode, {
      now: () => {
        time += 2;
        return time;
      },
      deadlineMs: 1,
    });
    expect(timed).toEqual({ results: [], complete: false, reason: "budget", scans: 0 });
  });

  it("does not fabricate a marker or call missing geometry a complete scan", () => {
    const fixture = frame(360, 300, [{ value: "AB12", left: 60, top: 50 }]);
    const result = scanQrFrame(fixture.pixels, fixture.width, fixture.height, (pixels, width, height) => {
      const code = decode(pixels, width, height);
      return code ? { data: code.data } : null;
    });
    expect(result).toMatchObject({ results: [{ data: "AB12" }], complete: false, reason: "unlocated" });
  });

  it("rejects malformed or oversized image buffers before allocating scan copies", () => {
    for (const [width, height] of [
      [0, 1],
      [1.2, 1],
      [1, -1],
      [20_000, 20_000],
      [2, 2],
    ]) {
      expect(() => scanQrFrame(new Uint8ClampedArray(4), width, height, decode)).toThrow("扫码图像尺寸无效");
    }
  });
});
