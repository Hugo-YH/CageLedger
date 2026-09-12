import { useEffect, useRef, useState } from "react";
import { captureQr, type ScannerChoices, type ScannerSnapshot } from "./frozenQr";
import { getQrCorners } from "./qrGeometry";
import type { QrWorkerResponse } from "./qrScanner.worker";

/** Own the camera stream and decoder lifetime, including delayed permission responses. */
export function useCameraScanner(onCode: (value: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const frozenRef = useRef<{ canvas: HTMLCanvasElement; image: ImageData | null; choices: ScannerChoices } | null>(
    null,
  );
  const selectionOpen = useRef(false);
  const generation = useRef(0);
  const starting = useRef(false);
  const onCodeRef = useRef(onCode);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<ScannerSnapshot | null>(null);
  const [choices, setChoices] = useState<ScannerChoices | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [selectionId, setSelectionId] = useState(0);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  function release() {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    workerRef.current?.terminate();
    workerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(
    () => () => {
      generation.current += 1;
      release();
      frozenRef.current = null;
    },
    [],
  );

  function selectCandidate(index: number) {
    const frozen = frozenRef.current;
    const candidate = frozen?.choices.candidates[index];
    if (!frozen || !candidate || !selectionOpen.current) return;
    selectionOpen.current = false;
    setChoosing(false);
    setSelectionId((value) => value + 1);
    onCodeRef.current(candidate.code.data);
    setSnapshot(frozen.image ? captureQr(frozen.canvas, frozen.image, candidate.code.location) : null);
  }

  function reopenChoices() {
    if (!frozenRef.current) return;
    selectionOpen.current = true;
    setSnapshot(null);
    setChoosing(true);
  }

  async function toggle() {
    if (starting.current) return;
    if (streamRef.current) {
      generation.current += 1;
      release();
      setActive(false);
      return;
    }
    starting.current = true;
    const request = ++generation.current;
    const isCurrent = () => generation.current === request;
    setPending(true);
    setError("");
    setSnapshot(null);
    setChoices(null);
    setChoosing(false);
    selectionOpen.current = false;
    frozenRef.current = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器无法访问摄像头，请输入识别码查询");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("扫码画面未就绪，请重试");
      video.srcObject = stream;
      await video.play();
      if (!isCurrent()) return;
      if (typeof Worker === "undefined") throw new Error("当前浏览器无法启动二维码识别，请输入识别码查询");
      const worker = new Worker(new URL("./qrScanner.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      setActive(true);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("当前浏览器无法读取扫码画面");
      const fail = (message: string) => {
        if (!isCurrent()) return;
        generation.current += 1;
        release();
        setActive(false);
        setPending(false);
        setError(message);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail("二维码识别器加载失败，请重试或输入识别码查询");
      };
      worker.onmessage = ({ data }: MessageEvent<QrWorkerResponse>) => {
        if (!isCurrent() || data.id !== request) return;
        if (data.error) {
          fail(data.error);
          return;
        }
        if (!data.results.length) {
          frameRef.current = requestAnimationFrame(tick);
          return;
        }
        generation.current += 1;
        release();
        setActive(false);
        setPending(false);
        let image: ImageData | null = null;
        let frame: ScannerSnapshot | null = null;
        try {
          // The worker returns the very frame it decoded, not a later camera image.
          image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height);
          canvas.width = data.width;
          canvas.height = data.height;
          context.putImageData(image, 0, 0);
          frame = captureQr(canvas, image, undefined);
        } catch {
          image = null;
        }
        if (data.results.length === 1 && data.complete) {
          onCodeRef.current(data.results[0].data);
          setSelectionId((value) => value + 1);
          setSnapshot(image ? captureQr(canvas, image, data.results[0].location) : null);
        } else {
          const nextChoices: ScannerChoices = {
            frame: frame?.frame || "",
            width: data.width,
            height: data.height,
            complete: data.complete,
            candidates: data.results
              .map((code) => ({
                code,
                corners: getQrCorners(code.location, data.width, data.height),
              }))
              .sort((a, b) => {
                if (!a.corners) return b.corners ? 1 : 0;
                if (!b.corners) return -1;
                const ay = Math.min(...a.corners.map(({ y }) => y));
                const by = Math.min(...b.corners.map(({ y }) => y));
                // Keep near-horizontal cards in reading order despite subpixel corner noise.
                return Math.abs(ay - by) < data.height * 0.02
                  ? Math.min(...a.corners.map(({ x }) => x)) - Math.min(...b.corners.map(({ x }) => x))
                  : ay - by;
              }),
          };
          frozenRef.current = { canvas, image, choices: nextChoices };
          selectionOpen.current = true;
          setChoices(nextChoices);
          setChoosing(true);
        }
      };
      let lastScan = -Infinity;
      const tick = (timestamp: number) => {
        if (!isCurrent()) return;
        try {
          if (
            timestamp - lastScan >= 100 &&
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            video.videoWidth &&
            video.videoHeight
          ) {
            lastScan = timestamp;
            const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
            const width = Math.max(1, Math.round(video.videoWidth * scale));
            const height = Math.max(1, Math.round(video.videoHeight * scale));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            worker.postMessage({ id: request, width: image.width, height: image.height, pixels: image.data }, [
              image.data.buffer,
            ]);
            return;
          }
          frameRef.current = requestAnimationFrame(tick);
        } catch (cause) {
          fail(cause instanceof Error ? cause.message : "无法读取扫码画面，请重试");
        }
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (cause) {
      if (isCurrent()) {
        release();
        setActive(false);
        setError(cause instanceof Error ? cause.message : "无法启动摄像头");
      }
    } finally {
      starting.current = false;
      if (isCurrent()) setPending(false);
    }
  }

  return {
    videoRef,
    active,
    pending,
    error,
    snapshot,
    choices,
    choosing,
    selectionId,
    selectCandidate,
    reopenChoices,
    toggle,
  };
}
