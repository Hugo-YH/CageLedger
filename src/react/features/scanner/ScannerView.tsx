import { useEffect, useId, useRef, useState } from "react";
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
  Skeleton,
  Tag,
  Typography,
  type InputRef,
} from "antd";

import { usePublicCageCard, type CageCardDetails } from "../../api/cageCard";
import type { WorkspaceView } from "../../state/ui";
import { WorkspaceToolbar } from "../../components/WorkspaceUi";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { useCameraScanner } from "./useCameraScanner";
import { ScannerCapture } from "./ScannerCapture";
import { ScannerCandidates } from "./ScannerCandidates";
import { normalizeCode } from "./scannerCode";

export function ScannerView({ navigate }: { navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const [input, setInput] = useState("");
  const [qrId, setQrId] = useState("");
  const inputId = useId();
  const inputRef = useRef<InputRef>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const result = usePublicCageCard(qrId);
  function lookup(value: string) {
    const code = normalizeCode(value);
    if (!code) return;
    if (code === qrId) void result.refetch({ cancelRefetch: false });
    else setQrId(code);
  }
  const {
    videoRef,
    active: cameraActive,
    pending: cameraPending,
    error: cameraError,
    snapshot: cameraSnapshot,
    choices: cameraChoices,
    choosing,
    selectionId,
    selectCandidate,
    reopenChoices,
    toggle: toggleCamera,
  } = useCameraScanner((value) => {
    const code = normalizeCode(value);
    setInput(code);
    lookup(code);
  });
  const cameraButtonLabel = cameraActive ? "停止扫码" : cameraSnapshot || cameraChoices ? "继续扫码" : "启动摄像头";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const content = (
    <Card
      className="scanner-card"
      extra={
        <Button
          ref={cameraButtonRef}
          aria-label={cameraButtonLabel}
          danger={cameraActive}
          icon={cameraActive ? <StopOutlined aria-hidden /> : <CameraOutlined aria-hidden />}
          type={cameraActive ? "default" : "primary"}
          loading={cameraPending}
          disabled={cameraPending}
          onClick={() => void toggleCamera()}
        >
          {cameraButtonLabel}
        </Button>
      }
      title={
        <Typography.Title level={2} style={{ margin: 0 }}>
          识别笼卡
        </Typography.Title>
      }
    >
      <div hidden={!cameraActive && !cameraPending && !cameraSnapshot && !cameraChoices}>
        <Card className="scanner-camera-card" size="small" title="扫码取景框" type="inner">
          <div className="scanner-camera" hidden={!cameraActive && !cameraPending}>
            <video ref={videoRef} muted playsInline aria-label="笼卡扫码画面" />
          </div>
          {choosing && cameraChoices ? (
            <ScannerCandidates
              choices={cameraChoices}
              onSelect={(index) => {
                selectCandidate(index);
                cameraButtonRef.current?.focus({ preventScroll: true });
              }}
            />
          ) : null}
          {cameraSnapshot ? <ScannerCapture key={selectionId} snapshot={cameraSnapshot} /> : null}
          {cameraChoices && !choosing ? <Button onClick={reopenChoices}>重新选择二维码</Button> : null}
          {cameraActive || cameraPending ? (
            <div className="scanner-camera-status" role="status">
              将笼卡二维码置于取景框内
            </div>
          ) : null}
        </Card>
      </div>
      {cameraError ? (
        <Alert role="alert" className="scanner-alert" title={`扫码失败：${cameraError}`} showIcon type="error" />
      ) : null}
      <div className="scanner-query-section" hidden={choosing}>
        <form
          className="scanner-query-form"
          onSubmit={(event) => {
            event.preventDefault();
            lookup(input);
          }}
        >
          <Form component={false} layout="vertical">
            <Flex align="flex-end" gap={12} wrap>
              <Form.Item className="scanner-code-field" label="笼卡识别码" htmlFor={inputId}>
                <Input
                  id={inputId}
                  ref={inputRef}
                  allowClear
                  placeholder="输入 4 位识别码或粘贴笼卡链接"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                />
              </Form.Item>
              <Button
                htmlType="submit"
                icon={<SearchOutlined aria-hidden />}
                type="primary"
                loading={result.isFetching}
              >
                查询
              </Button>
            </Flex>
            <Typography.Text type="secondary">支持新笼卡识别码和旧版笼卡链接。</Typography.Text>
          </Form>
        </form>
        {result.isFetching ? (
          <div aria-busy="true" aria-label="笼卡信息正在加载" className="scanner-loading" role="status">
            <span className="app-visually-hidden">笼卡信息正在加载</span>
            <Skeleton active paragraph={{ rows: 3 }} title={{ width: "36%" }} />
          </div>
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
      </div>
    </Card>
  );
  return (
    <MobilePage
      onBack={() => navigate("intake-entry")}
      title="识别笼卡"
      feature="intake"
      desktop={
        isMobile
          ? undefined
          : {
              className: "workspace-view scanner-workspace",
              bodyClassName: "workspace-body",
              toolbar: (
                <WorkspaceToolbar
                  actions={
                    <Button icon={<ArrowLeftOutlined aria-hidden />} onClick={() => navigate("intake-entry")}>
                      返回笼卡管理
                    </Button>
                  }
                />
              ),
            }
      }
    >
      {content}
    </MobilePage>
  );
}

function CageCardResult({ item }: { item: CageCardDetails }) {
  const rows = [
    ["当前状态", item.statusLabel || "状态未知"],
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
      extra={<Tag color="blue">{item.statusLabel || "状态未知"}</Tag>}
      size="small"
      title={String(item.batchNo || item.qrId || "笼卡详情")}
      type="inner"
    >
      <Descriptions
        column={{ lg: 3, md: 2, sm: 2, xs: 1 }}
        items={rows.map(([label, value]) => ({
          key: label,
          label,
          children: value === "" || value == null ? "-" : String(value),
        }))}
        size="small"
      />
    </Card>
  );
}
