import { useEffect, useRef, useState } from "react";

/** Own the camera stream and decoder lifetime, including delayed permission responses. */
export function useCameraScanner(onCode: (value: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const generation = useRef(0);
  const starting = useRef(false);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState("");

  function release() {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(
    () => () => {
      generation.current += 1;
      release();
    },
    [],
  );

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
    setSnapshot("");
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
      const [, decoderModule] = await Promise.all([video.play(), import("../../../vendor/jsQR.js")]);
      if (!isCurrent()) return;
      // Vite production builds expose this UMD dependency as a default export;
      // the dev server executes its browser-global branch instead.
      const decode = typeof decoderModule.default === "function" ? decoderModule.default : window.jsQR;
      if (typeof decode !== "function") throw new Error("二维码识别器加载失败，请重试或输入识别码查询");
      setActive(true);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("当前浏览器无法读取扫码画面");
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
            const result = decode(image.data, image.width, image.height);
            if (result?.data) {
              setSnapshot(canvas.toDataURL("image/jpeg", 0.85));
              generation.current += 1;
              release();
              setActive(false);
              onCode(result.data);
              return;
            }
          }
          frameRef.current = requestAnimationFrame(tick);
        } catch (cause) {
          release();
          setActive(false);
          setError(cause instanceof Error ? cause.message : "无法读取扫码画面，请重试");
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

  return { videoRef, active, pending, error, snapshot, toggle };
}
