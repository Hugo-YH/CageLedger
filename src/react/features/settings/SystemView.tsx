import { useState } from "react";
import { Alert, Button, Card, Descriptions, Flex, Segmented, Space, Tag, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import { useSystemInfo, useSystemUpdate } from "../../api/administration";
import { PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import { MobilePage } from "../../components/ui";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { useUiDispatch, useUiState, type WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

export function SystemView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const isMobile = useIsMobileLayout();
  const ui = useUiState();
  const dispatch = useUiDispatch();
  const info = useSystemInfo();
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
            {data.build ? `（${data.build}）` : ""}
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
              {data.build ? `（${data.build}）` : ""}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="代码版本">
            <Typography.Text code>{data.revisionShort || "未设置"}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="所属单位">{`${data.organization} · ${data.department}`}</Descriptions.Item>
          <Descriptions.Item label="开源协议">{data.license}</Descriptions.Item>
        </Descriptions>
        {checkEnabled ? <UpdateCard update={update} /> : null}
      </Card>
      <Card title={<CardTitle>维护信息</CardTitle>}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} layout="vertical" size="small">
          <Descriptions.Item label="开发维护">{data.developer}</Descriptions.Item>
          <Descriptions.Item label="联系邮箱">{data.contactEmail}</Descriptions.Item>
          <Descriptions.Item label="版权">{data.copyright}</Descriptions.Item>
        </Descriptions>
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
      <WorkspaceHeader
        kicker="系统与文档工作台"
        title="关于系统"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="集中查看当前版本、界面偏好与维护信息；更新记录由项目文档统一维护。"
        status={`当前版本 ${data.version}${data.build ? `（${data.build}）` : ""}`}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, user.role === "admin")}
      />
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
