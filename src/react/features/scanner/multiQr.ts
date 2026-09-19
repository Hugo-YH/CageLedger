import type jsQR from "../../../vendor/jsQR.js";
import { type QRCode } from "../../../vendor/jsQR.js";
import { getQrCorners, type Point, type Quad } from "./qrGeometry";

export type QrDecoder = typeof jsQR;
export type QrScanStopReason = "budget" | "limit" | "cancelled" | "unlocated";
export interface QrScanResult {
  results: QRCode[];
  /** All scheduled regions were examined, not a guarantee that blurred codes are readable. */
  complete: boolean;
  reason?: QrScanStopReason;
  scans: number;
}
export interface QrScanOptions {
  maxScans?: number;
  maxResults?: number;
  deadlineMs?: number;
  now?: () => number;
  /** Checked between decoder calls; terminating the worker also interrupts an active call. */
  isCancelled?: () => boolean;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Overlapping halves and corners separate finder patterns belonging to nearby codes. */
function scanRegions(width: number, height: number): Region[] {
  const w = Math.ceil(width * 0.62);
  const h = Math.ceil(height * 0.62);
  const regions = [
    { x: 0, y: 0, width, height },
    { x: 0, y: 0, width: w, height },
    { x: width - w, y: 0, width: w, height },
    { x: 0, y: 0, width, height: h },
    { x: 0, y: height - h, width, height: h },
    { x: 0, y: 0, width: w, height: h },
    { x: width - w, y: 0, width: w, height: h },
    { x: 0, y: height - h, width: w, height: h },
    { x: width - w, y: height - h, width: w, height: h },
  ];
  return regions.filter(
    (region, index) =>
      regions.findIndex(
        (other) =>
          other.x === region.x &&
          other.y === region.y &&
          other.width === region.width &&
          other.height === region.height,
      ) === index,
  );
}

function regionPixels(pixels: Uint8ClampedArray, width: number, region: Region): Uint8ClampedArray {
  if (region.x === 0 && region.width === width && region.y === 0 && region.height * width * 4 === pixels.length)
    return pixels;
  const cropped = new Uint8ClampedArray(region.width * region.height * 4);
  for (let row = 0; row < region.height; row += 1) {
    const start = ((region.y + row) * width + region.x) * 4;
    cropped.set(pixels.subarray(start, start + region.width * 4), row * region.width * 4);
  }
  return cropped;
}

function isUniform(pixels: Uint8ClampedArray): boolean {
  for (let index = 4; index < pixels.length; index += 4) {
    if (pixels[index] !== pixels[0] || pixels[index + 1] !== pixels[1] || pixels[index + 2] !== pixels[2]) return false;
  }
  return true;
}

function absoluteCode(code: QRCode, quad: Quad, region: Region): QRCode {
  const [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner] = quad.map(({ x, y }) => ({
    x: x + region.x,
    y: y + region.y,
  }));
  return {
    data: code.data,
    location: { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner },
  };
}

function center(quad: Quad): Point {
  return {
    x: quad.reduce((sum, point) => sum + point.x, 0) / 4,
    y: quad.reduce((sum, point) => sum + point.y, 0) / 4,
  };
}

function samePosition(a: Quad, b: Quad): boolean {
  const first = center(a);
  const second = center(b);
  const edge = Math.min(
    ...[a, b].flatMap((quad) =>
      quad.map((point, index) => Math.hypot(point.x - quad[(index + 1) % 4].x, point.y - quad[(index + 1) % 4].y)),
    ),
  );
  return Math.hypot(first.x - second.x, first.y - second.y) < edge * 0.3;
}

/** Erase only this decoded quadrilateral in the working copy, leaving adjacent codes intact. */
function maskCode(pixels: Uint8ClampedArray, width: number, height: number, quad: Quad): void {
  const startY = Math.max(0, Math.floor(Math.min(...quad.map((point) => point.y))));
  const endY = Math.min(height, Math.ceil(Math.max(...quad.map((point) => point.y))));
  for (let y = startY; y < endY; y += 1) {
    const intersections: number[] = [];
    const line = y + 0.5;
    for (let index = 0; index < 4; index += 1) {
      const a = quad[index];
      const b = quad[(index + 1) % 4];
      if ((a.y <= line && b.y > line) || (b.y <= line && a.y > line))
        intersections.push(a.x + ((line - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    if (intersections.length < 2) continue;
    const left = Math.max(0, Math.floor(Math.min(...intersections)));
    const right = Math.min(width, Math.ceil(Math.max(...intersections)));
    pixels.fill(255, (y * width + left) * 4, (y * width + right) * 4);
  }
}

/**
 * Decode every planned region of one immutable frame. Run in a worker: a jsQR
 * call is synchronous and can only be interrupted immediately by terminating it.
 * A truncated scan must never be interpreted as proof that there is one code.
 */
export function scanQrFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  decode: QrDecoder,
  options: QrScanOptions = {},
): QrScanResult {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4_000_000 ||
    pixels.length !== width * height * 4
  )
    throw new Error("扫码图像尺寸无效");
  const maxScans = Math.max(1, Math.min(64, Math.floor(options.maxScans ?? 32)));
  const maxResults = Math.max(1, Math.min(32, Math.floor(options.maxResults ?? 16)));
  const deadline = Math.max(1, Math.min(5000, options.deadlineMs ?? 900));
  const now = options.now ?? (() => performance.now());
  const started = now();
  const masked = new Uint8ClampedArray(pixels);
  const results: QRCode[] = [];
  const corners: Quad[] = [];
  let scans = 0;
  let unlocated = false;
  function stopped(reason: QrScanStopReason): QrScanResult {
    return { results, complete: false, reason, scans };
  }

  for (const region of scanRegions(width, height)) {
    while (true) {
      if (options.isCancelled?.()) return stopped("cancelled");
      if (scans >= maxScans || now() - started >= deadline) return stopped("budget");
      const cropped = regionPixels(masked, width, region);
      if (isUniform(cropped)) break;
      scans += 1;
      const code = decode(cropped, region.width, region.height);
      if (!code?.data) break;
      const localQuad = getQrCorners(code.location, region.width, region.height);
      if (!localQuad) {
        // Preserve a decoded value for an explicit choice, never invent a box.
        if (!results.some((other) => !other.location && other.data === code.data)) results.push({ data: code.data });
        unlocated = true;
        break;
      }
      const absolute = absoluteCode(code, localQuad, region);
      const absoluteQuad = getQrCorners(absolute.location, width, height)!;
      const duplicate = corners.some((previous) => samePosition(previous, absoluteQuad));
      maskCode(masked, width, height, absoluteQuad);
      if (duplicate) break;
      results.push(absolute);
      corners.push(absoluteQuad);
      if (results.length >= maxResults) return stopped("limit");
    }
  }
  if (options.isCancelled?.()) return stopped("cancelled");
  return { results, complete: !unlocated, ...(unlocated ? { reason: "unlocated" as const } : {}), scans };
}
