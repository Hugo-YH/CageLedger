import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { requestJson } from "../../api/client";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, intakeSwitchItems } from "../shell/workspaceNavigation";
import { WorkspaceHeader } from "../../components/WorkspaceUi";

type CageCardDetails = Record<string, string | number | null | undefined>;

export function ScannerView({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const [input, setInput] = useState("");
  const [qrId, setQrId] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const result = useQuery({
    queryKey: ["cage-card-lookup", qrId],
    queryFn: () => requestJson<CageCardDetails>(`/api/public/cage-card/${encodeURIComponent(qrId)}`),
    enabled: Boolean(qrId),
    retry: false,
  });

  useEffect(() => () => stopCamera(streamRef, frameRef), []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function toggleCamera() {
    if (cameraActive) {
      stopCamera(streamRef, frameRef);
      setCameraActive(false);
      return;
    }
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await import("../../../vendor/jsQR.js");
      setCameraActive(true);
      scanFrame(videoRef.current, frameRef, (value) => {
        const code = normalizeCode(value);
        setInput(code);
        setQrId(code);
        stopCamera(streamRef, frameRef);
        setCameraActive(false);
      });
    } catch (error) {
      stopCamera(streamRef, frameRef);
      setCameraError(error instanceof Error ? error.message : "无法启动摄像头");
    }
  }

  return (
    <section className="workspace-view scanner-workspace">
      <WorkspaceHeader
        kicker="笼卡快速识别"
        title="二维码扫描"
        breadcrumbs={[breadcrumb("笼卡管理", () => navigate("intake-entry"))]}
        summary="扫描二维码或输入笼卡识别码，查询当前笼位、项目和接收状态。"
        status={cameraActive ? "摄像头开启" : "只读查询"}
        actions={
          <button className="secondary" type="button" onClick={() => navigate("intake-entry")}>
            返回笼卡管理
          </button>
        }
        switcherLabel="笼卡功能"
        switcherItems={intakeSwitchItems(navigate)}
      />
      <div className="workspace-body">
        <section className="panel scanner-panel">
          <div className="panel-head">
            <div className="panel-title-line">
              <h2>识别笼卡</h2>
            </div>
            <div className="panel-head-actions">
              <button
                className={cameraActive ? "secondary" : "primary"}
                type="button"
                onClick={() => void toggleCamera()}
              >
                {cameraActive ? "停止扫码" : "启动摄像头"}
              </button>
            </div>
          </div>
          <div className={`scanner-camera ${cameraActive ? "" : "scanner-camera-inactive"}`}>
            <video ref={videoRef} muted playsInline aria-label="笼卡扫码画面" />
            <span>将笼卡二维码置于取景框内</span>
          </div>
          {cameraError ? (
            <div className="react-inline-notice" role="alert">
              摄像头启动失败：{cameraError}
            </div>
          ) : null}
          <form
            className="scanner-query-form"
            onSubmit={(event) => {
              event.preventDefault();
              setQrId(normalizeCode(input));
            }}
          >
            <label>
              笼卡识别码
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="输入 4 位识别码或粘贴笼卡链接"
              />
            </label>
            <button className="primary" type="submit">
              查询
            </button>
          </form>
          {result.isFetching ? (
            <div className="public-scan-state">正在查询...</div>
          ) : result.error ? (
            <div className="react-inline-notice" role="alert">
              {result.error.message}
            </div>
          ) : result.data ? (
            <CageCardResult item={result.data} />
          ) : (
            <div className="empty-state">
              <h3>等待识别</h3>
              <p>支持新笼卡识别码和旧版笼卡链接。</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function CageCardResult({ item }: { item: CageCardDetails }) {
  const rows = [
    ["当前状态", item.statusLabel],
    ["批次号", item.batchNo],
    ["笼号", item.cageCode || item.slotCode],
    ["房间", item.roomName],
    ["IACUC", item.iacuc],
    ["项目负责人", item.pi],
    ["实验负责人", item.owner],
    ["品系", item.strainStandard || item.speciesLabel],
    ["数量", item.animalCount],
  ];
  return (
    <div className="scanner-result">
      <div className="public-scan-header">
        <h2>{String(item.batchNo || item.qrId || "笼卡详情")}</h2>
        <span className="public-scan-status">{String(item.statusLabel || "待接收")}</span>
      </div>
      <dl className="public-scan-grid">
        {rows.map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{String(value || "-")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function normalizeCode(value: string) {
  const raw = value.trim();
  const pathCode = raw.match(/\/(?:c|scan\/cage-card)\/([^/?#]+)/i)?.[1];
  return decodeURIComponent(pathCode || raw).toUpperCase();
}

function stopCamera(streamRef: React.RefObject<MediaStream | null>, frameRef: React.RefObject<number>) {
  if (frameRef.current) cancelAnimationFrame(frameRef.current);
  frameRef.current = 0;
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
}

function scanFrame(video: HTMLVideoElement, frameRef: React.RefObject<number>, onCode: (value: string) => void) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const tick = () => {
    if (!context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      frameRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR?.(image.data, image.width, image.height);
    if (result?.data) {
      onCode(result.data);
      return;
    }
    frameRef.current = requestAnimationFrame(tick);
  };
  frameRef.current = requestAnimationFrame(tick);
}
