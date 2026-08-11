import { DownloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useState } from "react";
import { Alert, Button, Card, Descriptions, Divider, Flex, Segmented, Skeleton, Space, Tag, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import { useSystemEnvironment, useSystemInfo, useSystemUpdate } from "../../api/administration";
import { PageState } from "../../components/WorkspaceUi";
import { MobilePage } from "../../components/ui/MobilePage";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { useUiDispatch, useUiState, type WorkspaceView } from "../../state/ui";

const CERTIFICATE_DOWNLOAD_URL = "/docs/cageledger.crt";
const CERTIFICATE_FINGERPRINT =
  "A4:6A:89:6F:68:17:C4:A5:45:55:77:5F:1B:F7:8B:A4:75:D7:82:68:5D:3B:92:60:A4:B7:1F:BE:BE:8C:B2:2E";

export function SystemView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const ui = useUiState();
  const dispatch = useUiDispatch();
  const info = useSystemInfo();
  const environment = useSystemEnvironment(user.role === "admin");
  const [checkEnabled, setCheckEnabled] = useState(false);
  const update = useSystemUpdate(checkEnabled && user.role === "admin");
  if (info.isPending)
    return (
      <section className="workspace-view">
        <PageState title="正在加载系统信息..." />
      </section>
    );
  if (info.isError || !info.data)
    return (
      <section className="workspace-view">
        <PageState title="系统信息加载失败" retry={() => info.refetch()} />
      </section>
    );

  const data = info.data;
  const hero = (
    <Card className="system-hero-card">
      <Flex align="center" gap={16} wrap>
        <img alt="" src="/cageledger-icon.svg" style={{ borderRadius: 12, height: 56, width: 56 }} />
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {data.title}
          </Typography.Title>
          <Tag color="blue" style={{ marginTop: 6 }}>
            {data.version}
            {data.build ? `（Build ${data.build}）` : ""}
          </Tag>
        </div>
        <Space style={{ marginLeft: "auto" }} wrap>
          <Button href="/docs/" type="link">
            项目文档
          </Button>
          <Button href="/docs/releases/" type="link">
            更新记录
          </Button>
          <Button href={data.repositoryUrl} rel="noreferrer" target="_blank" type="link">
            Gitea 仓库
          </Button>
        </Space>
      </Flex>
      <Typography.Paragraph className="system-hero-description" type="secondary">
        {data.description}
      </Typography.Paragraph>
    </Card>
  );
  const content = (
    <>
      {hero}
      <Card
        className="system-status-card"
        extra={
          user.role === "admin" ? (
            <Button
              loading={update.isFetching}
              onClick={() => {
                setCheckEnabled(true);
                if (checkEnabled) void update.refetch();
              }}
            >
              检查更新
            </Button>
          ) : null
        }
        title={<CardTitle>系统状态</CardTitle>}
      >
        <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} layout="vertical" size="small">
          <Descriptions.Item label="当前版本">
            <Typography.Text strong>
              {data.version}
              {data.build ? `（Build ${data.build}）` : ""}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="代码版本">
            <Typography.Text code>{data.revisionShort || "未设置"}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="所属单位">{`${data.organization} · ${data.department}`}</Descriptions.Item>
          <Descriptions.Item label="开源协议">{data.license}</Descriptions.Item>
        </Descriptions>
        {user.role === "admin" ? (
          <>
            <Divider dashed style={{ margin: "16px 0" }} />
            <Flex align="center" justify="space-between" style={{ marginBottom: 12 }}>
              <Typography.Text strong>运行环境</Typography.Text>
              <Space size={8}>
                <Typography.Text type="secondary">容器视角 · 静态参数</Typography.Text>
                <Button size="small" loading={environment.isFetching} onClick={() => void environment.refetch()}>
                  刷新运行环境
                </Button>
              </Space>
            </Flex>
            {environment.isPending ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : environment.isError ? (
              <Alert description={environment.error.message} showIcon title="运行环境信息获取失败" type="error" />
            ) : environment.data ? (
              <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} layout="vertical" size="small">
                <Descriptions.Item label="CPU 型号">{environment.data.cpu.model || "未知"}</Descriptions.Item>
                <Descriptions.Item label="CPU 架构">{environment.data.cpu.architecture}</Descriptions.Item>
                <Descriptions.Item label="逻辑核心数">{`${environment.data.cpu.cores} 核`}</Descriptions.Item>
                <Descriptions.Item label="负载（1/5/15 分钟）">
                  {formatLoad(environment.data.cpu.load)}
                </Descriptions.Item>
                <Descriptions.Item label="内存总量">
                  {formatBytes(environment.data.memory.totalBytes)}
                </Descriptions.Item>
                <Descriptions.Item label="操作系统">{environment.data.system.platform}</Descriptions.Item>
                <Descriptions.Item label="内核版本">{environment.data.system.release}</Descriptions.Item>
                <Descriptions.Item label="主机名">{environment.data.system.hostname}</Descriptions.Item>
                <Descriptions.Item label="运行形态">
                  {environment.data.system.container === "docker" ? "Docker 容器" : "本机进程"}
                </Descriptions.Item>
                <Descriptions.Item label="Python 版本">{environment.data.python.version}</Descriptions.Item>
                <Descriptions.Item label="Python 实现">{environment.data.python.implementation}</Descriptions.Item>
                <Descriptions.Item label="编译器">{environment.data.python.compiler}</Descriptions.Item>
                <Descriptions.Item label="解释器路径">
                  <Typography.Text code style={{ wordBreak: "break-all" }}>
                    {environment.data.python.executable}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="64 位">{environment.data.python.bits64 ? "是" : "否"}</Descriptions.Item>
                <Descriptions.Item label="数据库状态">
                  {environment.data.database.ok ? <Tag color="success">正常</Tag> : <Tag color="error">异常</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="数据库文件">
                  {formatBytes(environment.data.database.sizeBytes)}
                </Descriptions.Item>
                <Descriptions.Item label="WAL 模式">{environment.data.database.journalMode || "—"}</Descriptions.Item>
                <Descriptions.Item label="数据表数量">{`${environment.data.database.tables} 张`}</Descriptions.Item>
                <Descriptions.Item label="数据库路径">
                  <Typography.Text code style={{ wordBreak: "break-all" }}>
                    {environment.data.database.path}
                  </Typography.Text>
                </Descriptions.Item>
              </Descriptions>
            ) : null}
          </>
        ) : null}
        {checkEnabled ? <UpdateCard update={update} /> : null}
      </Card>
      <Card title={<CardTitle>维护信息</CardTitle>}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} layout="vertical" size="small">
          <Descriptions.Item label="开发维护">{data.developer}</Descriptions.Item>
          <Descriptions.Item label="联系邮箱">{data.contactEmail}</Descriptions.Item>
          <Descriptions.Item label="版权">{data.copyright}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title={<CardTitle>HTTPS 访问证书</CardTitle>}>
        <Space orientation="vertical" size={16} style={{ display: "flex" }}>
          <Alert
            description="在受控客户端安装此证书后，可通过群晖反向代理的 HTTPS 地址使用剪贴板、摄像头等浏览器安全能力。"
            icon={<SafetyCertificateOutlined aria-hidden />}
            title="内网客户端受信任根证书"
            showIcon
            type="info"
          />
          <Descriptions column={{ xs: 1, sm: 2 }} layout="vertical" size="small">
            <Descriptions.Item label="适用地址">
              <Typography.Text code>https://10.100.47.47</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="有效期">2026-08-11 至 2036-08-08</Descriptions.Item>
            <Descriptions.Item label="SHA-256 指纹" span="filled">
              <Typography.Text code style={{ overflowWrap: "anywhere" }}>
                {CERTIFICATE_FINGERPRINT}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Flex gap={8} wrap>
            <Button
              download="cageledger.crt"
              href={CERTIFICATE_DOWNLOAD_URL}
              icon={<DownloadOutlined aria-hidden />}
              type="primary"
            >
              下载 CageLedger 证书
            </Button>
            <Button href="/docs/operations/https-and-certificate">查看各设备安装说明</Button>
          </Flex>
          <Typography.Text type="secondary">
            下载文件只包含公开证书。群晖反向代理使用的私钥应保存在 DSM 证书管理中。
          </Typography.Text>
        </Space>
      </Card>
      <Card title={<CardTitle>界面外观</CardTitle>}>
        <Space orientation="vertical" size={8} style={{ display: "flex", maxWidth: 420 }}>
          <Typography.Text>显示模式</Typography.Text>
          <Segmented
            aria-label="显示模式"
            block
            onChange={(theme) => dispatch({ type: "set-theme", theme: theme as "system" | "light" | "dark" })}
            options={[
              { label: "跟随系统", value: "system" },
              { label: "浅色", value: "light" },
              { label: "深色", value: "dark" },
            ]}
            value={ui.theme}
          />
          <Typography.Text type="secondary">主题仅影响本设备界面，不影响业务数据与其他用户。</Typography.Text>
        </Space>
      </Card>
    </>
  );
  if (isMobile) {
    return (
      <MobilePage onBack={() => navigate("rooms")} title="关于系统">
        {content}
      </MobilePage>
    );
  }
  return (
    <section className="workspace-view system-workspace" data-feature="administration">
      <div className="workspace-body system-workspace-body">
        <div className="system-layout">{content}</div>
      </div>
    </section>
  );
}

function CardTitle({ children }: { children: string }) {
  return (
    <Typography.Title level={2} className="ant-card-section-title">
      {children}
    </Typography.Title>
  );
}

function UpdateCard({ update }: { update: ReturnType<typeof useSystemUpdate> }) {
  const status = update.isFetching
    ? "正在检查最新 Release"
    : update.data?.updateAvailable
      ? "发现新版本"
      : update.data?.disabled
        ? "更新检查已关闭"
        : "当前已是最新版本";
  return (
    <Alert
      className="system-update-alert"
      description={
        <Space orientation="vertical" size={4}>
          <Typography.Text>
            {update.data?.latestVersion ? `最新发布版 ${update.data.latestVersion}` : "尚未获取远端版本"}
          </Typography.Text>
          {update.data?.latestMessage ? <Typography.Text>{update.data.latestMessage}</Typography.Text> : null}
          {update.isError ? <Typography.Text type="danger">{update.error.message}</Typography.Text> : null}
          {update.data?.latestUrl ? (
            <a href={update.data.latestUrl} rel="noreferrer" target="_blank">
              查看发布页
            </a>
          ) : null}
        </Space>
      }
      title={status}
      showIcon
      type={update.isError ? "error" : update.data?.updateAvailable ? "warning" : "info"}
    />
  );
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "未知";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  return `${(value / 1024 ** 2).toFixed(0)} MiB`;
}

function formatLoad(load: [number | null, number | null, number | null]): string {
  if (load.every((value) => value === null)) return "不可用";
  return load.map((value) => (value === null ? "—" : value.toFixed(2))).join(" / ");
}
