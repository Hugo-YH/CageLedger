import { scanQrFrame, type QrDecoder, type QrScanResult } from "./multiQr";

export interface QrWorkerRequest {
  id: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
}
export interface QrWorkerResponse extends QrWorkerRequest, QrScanResult {
  error?: string;
}

const scope = globalThis as unknown as {
  jsQR?: QrDecoder;
  onmessage: ((event: MessageEvent<QrWorkerRequest>) => void) | null;
  postMessage: (message: QrWorkerResponse, transfer: Transferable[]) => void;
};
let decoder: Promise<QrDecoder> | undefined;

function loadDecoder(): Promise<QrDecoder> {
  return (decoder ??= import("../../../vendor/jsQR.js").then((module) => {
    const value = typeof module.default === "function" ? module.default : scope.jsQR;
    if (typeof value !== "function") throw new Error("二维码识别器加载失败，请重试");
    return value;
  }));
}

async function scan(request: QrWorkerRequest): Promise<void> {
  let result: QrScanResult;
  let error: string | undefined;
  try {
    const decode = await loadDecoder();
    result = scanQrFrame(request.pixels, request.width, request.height, decode);
  } catch (cause) {
    result = { results: [], complete: false, scans: 0 };
    error = cause instanceof Error ? cause.message : "二维码识别失败，请重试";
  }
  // Transfer the untouched frame back, so the selected code uses the same real
  // pixels as every candidate and no extra frame is captured after detection.
  scope.postMessage({ ...request, ...result, ...(error ? { error } : {}) }, [request.pixels.buffer]);
}

scope.onmessage = (event) => {
  void scan(event.data);
};
