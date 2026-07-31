import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftOutlined, CameraOutlined, SearchOutlined, StopOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  Result,
  Spin,
  Tag,
  Typography,
  type InputRef,
} from "antd";

import { requestJson } from "../../api/client";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, intakeSwitchItems } from "../shell/workspaceNavigation";
import { WorkspaceHeader } from "../../components/WorkspaceUi";
import { MobilePage } from "../../components/ui";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";

type CageCardDetails = Record<string, string | number | null | undefined>;

export function ScannerView({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const [input, setInput] = useState("");
  const [qrId, setQrId] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<InputRef>(null);
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

  const content = (
    <Card
      className="scanner-card"
      extra={
        <Button
          danger={cameraActive}
          icon={cameraActive ? <StopOutlined aria-hidden /> : <CameraOutlined aria-hidden />}
          type={cameraActive ? "default" : "primary"}
          onClick={() => void toggleCamera()}
        >
          {cameraActive ? "停止扫码" : "启动摄像头"}
        </Button>
      }
      title={
        <Typography.Title level={2} style={{ margin: 0 }}>
          识别笼卡
        </Typography.Title>
      }
    >
      {cameraActive ? (
        <Card className="scanner-camera-card" size="small" title="扫码取景框" type="inner">
          <div className="scanner-camera">
            <video ref={videoRef} muted playsInline aria-label="笼卡扫码画面" />
            <span>将笼卡二维码置于取景框内</span>
          </div>
        </Card>
      ) : null}
      {cameraError ? (
        <Alert className="scanner-alert" title={`摄像头启动失败：${cameraError}`} showIcon type="error" />
      ) : null}
      <form
        className="scanner-query-form"
        onSubmit={(event) => {
          event.preventDefault();
          setQrId(normalizeCode(input));
        }}
      >
        <Form component={false} layout="vertical">
          <Flex align="flex-end" gap={12} wrap>
            <Form.Item className="scanner-code-field" label="笼卡识别码">
              <Input
                ref={inputRef}
                allowClear
                placeholder="输入 4 位识别码或粘贴笼卡链接"
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </Form.Item>
            <Button htmlType="submit" icon={<SearchOutlined />} type="primary">
              查询
            </Button>
          </Flex>
          <Typography.Text type="secondary">支持新笼卡识别码和旧版笼卡链接。</Typography.Text>
        </Form>
      </form>
      {result.isFetching ? (
        <Flex className="scanner-loading" align="center" gap={8} justify="center">
          <Spin size="small" />
          <Typography.Text type="secondary">正在查询笼卡信息...</Typography.Text>
        </Flex>
      ) : result.error ? (
        <Result
          extra={<Button onClick={() => void result.refetch()}>重新查询</Button>}
          status="error"
          subTitle={result.error.message}
          title="查询失败"
        />
      ) : result.data ? (
        <CageCardResult item={result.data} />
      ) : (
        <Empty
          className="scanner-empty"
          description="输入识别码或启动摄像头开始查询"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </Card>
  );
  if (isMobile) {
    return (
      <MobilePage onBack={() => navigate("intake-entry")} title="识别笼卡">
        {content}
      </MobilePage>
    );
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
          <Button icon={<ArrowLeftOutlined aria-hidden />} onClick={() => navigate("intake-entry")}>
            返回笼卡管理
          </Button>
        }
        switcherLabel="笼卡功能"
        switcherItems={intakeSwitchItems(navigate)}
      />
      <div className="workspace-body">{content}</div>
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
  ] as const;
  return (
    <Card
      className="scanner-result-card"
      extra={<Tag color="blue">{String(item.statusLabel || "待接收")}</Tag>}
      size="small"
      title={String(item.batchNo || item.qrId || "笼卡详情")}
      type="inner"
    >
      <Descriptions
        column={{ lg: 3, md: 2, sm: 2, xs: 1 }}
        items={rows.map(([label, value]) => ({ key: label, label, children: String(value || "-") }))}
        size="small"
      />
    </Card>
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
