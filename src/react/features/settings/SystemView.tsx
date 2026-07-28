import { useState } from "react";
import { Alert, Button, Card, Descriptions, Pagination, Select, Space, Tag, Typography } from "antd";

import type { SessionUser } from "../../api/contracts";
import { useSystemInfo, useSystemUpdate } from "../../api/administration";
import { PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import { SYSTEM_RELEASE_NOTES } from "../../releaseNotes";
import { useUiDispatch, useUiState, type WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

export function SystemView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const ui = useUiState();
  const dispatch = useUiDispatch();
  const info = useSystemInfo();
  const [checkEnabled, setCheckEnabled] = useState(false);
  const [releasePage, setReleasePage] = useState(1);
  const [releasePageSize, setReleasePageSize] = useState(5);
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
  return (
    <section className="workspace-view system-workspace">
      <WorkspaceHeader
        kicker="系统与文档工作台"
        title="关于系统"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="集中查看当前版本、正式文档、发布记录和反馈入口。"
        status={`当前版本 v${data.version}`}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, user.role === "admin")}
      />
      <div className="workspace-body system-workspace-body">
        <div className="system-layout">
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
                <Typography.Text strong>v{data.version}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="代码版本">
                <Typography.Text code>{data.revisionShort || "未设置"}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="所属单位">{`${data.organization} · ${data.department}`}</Descriptions.Item>
              <Descriptions.Item label="开源协议">{data.license}</Descriptions.Item>
            </Descriptions>
            {checkEnabled ? <UpdateCard update={update} /> : null}
          </Card>

          <Card
            className="system-release-card"
            extra={<Tag>{SYSTEM_RELEASE_NOTES.length} 个版本</Tag>}
            title={<CardTitle>更新记录</CardTitle>}
          >
            <div className="system-release-list">
              {SYSTEM_RELEASE_NOTES.slice((releasePage - 1) * releasePageSize, releasePage * releasePageSize).map(
                (note) => (
                  <article className="system-release-item" key={note.version}>
                    <Space size={8}>
                      <Typography.Text strong>v{note.version}</Typography.Text>
                      {note.releasedAt ? <Typography.Text type="secondary">{note.releasedAt}</Typography.Text> : null}
                    </Space>
                    <Space orientation="vertical" size={4}>
                      <Typography.Text>{note.title}</Typography.Text>
                      <ul className="system-release-items">
                        {note.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      {note.note || note.notes ? (
                        <Typography.Text type="secondary">备注：{note.note || note.notes}</Typography.Text>
                      ) : null}
                    </Space>
                  </article>
                ),
              )}
            </div>
            <Pagination
              className="system-release-pagination"
              current={releasePage}
              pageSize={releasePageSize}
              pageSizeOptions={[5, 10, 20]}
              showSizeChanger
              total={SYSTEM_RELEASE_NOTES.length}
              onChange={(page, pageSize) => {
                setReleasePage(page);
                setReleasePageSize(pageSize);
              }}
              onShowSizeChange={(_current, pageSize) => {
                setReleasePage(1);
                setReleasePageSize(pageSize);
              }}
            />
          </Card>

          <Card title={<CardTitle>界面外观</CardTitle>}>
            <Space align="start" orientation="vertical" size={8}>
              <Typography.Text>显示模式</Typography.Text>
              <Select
                aria-label="显示模式"
                onChange={(theme) => dispatch({ type: "set-theme", theme })}
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

          <Card title={<CardTitle>维护信息</CardTitle>}>
            <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} layout="vertical" size="small">
              <Descriptions.Item label="开发维护">{data.developer}</Descriptions.Item>
              <Descriptions.Item label="联系邮箱">{data.contactEmail}</Descriptions.Item>
              <Descriptions.Item label="版权">{data.copyright}</Descriptions.Item>
            </Descriptions>
          </Card>
        </div>
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
            {update.data?.latestVersion ? `最新发布版 v${update.data.latestVersion}` : "尚未获取远端版本"}
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
