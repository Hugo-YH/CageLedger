import { getQrCorners, rectifyQr, type Quad } from "./qrGeometry";
import type { QRCode } from "../../../vendor/jsQR";

export interface ScannerChoices {
  frame: string;
  width: number;
  height: number;
  complete: boolean;
  candidates: { code: QRCode; corners: Quad | null }[];
}

export interface ScannerSnapshot {
  frame: string;
  width: number;
  height: number;
  focus: { image: string; size: number; corners: Quad } | null;
}

/** Optional visual processing must never prevent a successfully decoded card lookup. */
export function captureQr(canvas: HTMLCanvasElement, pixels: ImageData, location: unknown): ScannerSnapshot | null {
  let snapshot: ScannerSnapshot;
  try {
    snapshot = {
      frame: canvas.toDataURL("image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
      focus: null,
    };
  } catch {
    return null;
  }
  try {
    const corners = getQrCorners(location, pixels.width, pixels.height);
    const corrected = corners && rectifyQr(pixels, corners);
    if (corrected && corners) {
      const texture = document.createElement("canvas");
      texture.width = texture.height = corrected.width;
      const context = texture.getContext("2d");
      if (context) {
        context.putImageData(corrected, 0, 0);
        snapshot.focus = { image: texture.toDataURL("image/png"), size: corrected.width, corners };
      }
    }
  } catch {
    // Retain the unmodified frame when geometry or pixel processing is unavailable.
  }
  return snapshot;
}
