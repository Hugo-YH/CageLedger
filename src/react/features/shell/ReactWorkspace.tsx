import {
  AppstoreOutlined,
  AuditOutlined,
  BookOutlined,
  CalculatorOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SettingOutlined,
  ShopOutlined,
  TagsOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Space, Tooltip, Typography, type MenuProps } from "antd";
import { lazy, Suspense, type ReactNode, useState } from "react";

import type { SessionUser } from "../../api/contracts";
import { useSystemInfo } from "../../api/administration";
import { useLogout } from "../../api/session";
import { clearUiStorage, persistWorkspaceView } from "../../state/uiStorage";
import { useUiDispatch, useUiState, type WorkspaceView } from "../../state/ui";
import { APP_VERSION } from "../../version";
import { useIsMobileLayout } from "../../hooks/useIsMobileLayout";
import { WorkspaceErrorBoundary, WorkspaceLoading } from "./WorkspaceErrorBoundary";
import { billingSidebarItems, isWorkspaceView } from "./workspaceNavigation";

const IntakeView = lazy(() => import("../intake/IntakeView").then((module) => ({ default: module.IntakeView })));
const ScannerView = lazy(() => import("../scanner/ScannerView").then((module) => ({ default: module.ScannerView })));
const CagesView = lazy(() => import("../cages/CagesView").then((module) => ({ default: module.CagesView })));
const DashboardView = lazy(() =>
  import("../dashboard/DashboardView").then((module) => ({ default: module.DashboardView })),
);
const MobileNavigation = lazy(() =>
  import("./MobileNavigation").then((module) => ({ default: module.MobileNavigation })),
);
const AnimalManagementView = lazy(() =>
  import("../animal-management/AnimalManagementView").then((module) => ({ default: module.AnimalManagementView })),
);
const BillingView = lazy(() => import("../billing/BillingView").then((module) => ({ default: module.BillingView })));
const WorkflowCenterView = lazy(() =>
  import("../workflows/WorkflowCenterView").then((module) => ({ default: module.WorkflowCenterView })),
);
const RoomsView = lazy(() => import("../settings/RoomsView").then((module) => ({ default: module.RoomsView })));
const UsersView = lazy(() => import("../settings/UsersView").then((module) => ({ default: module.UsersView })));
const DataView = lazy(() => import("../settings/DataView").then((module) => ({ default: module.DataView })));
const LogsView = lazy(() => import("../settings/LogsView").then((module) => ({ default: module.LogsView })));
const SystemView = lazy(() => import("../settings/SystemView").then((module) => ({ default: module.SystemView })));

type NavIcon =
  "tag" | "grid" | "calculator" | "refresh" | "book" | "clipboard" | "building" | "info" | "database" | "users";

const iconFor: Record<NavIcon, ReactNode> = {
  tag: <TagsOutlined />,
  grid: <AppstoreOutlined />,
  calculator: <CalculatorOutlined />,
  refresh: <ReloadOutlined />,
  book: <BookOutlined />,
  clipboard: <AuditOutlined />,
  building: <ShopOutlined />,
  info: <InfoCircleOutlined />,
  database: <DatabaseOutlined />,
  users: <TeamOutlined />,
};

export function ReactWorkspace({ user }: { user: SessionUser }) {
  const ui = useUiState();
  const dispatch = useUiDispatch();
  const logout = useLogout();
  const systemInfo = useSystemInfo();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const isMobileLayout = useIsMobileLayout();

  const settingsViews: Array<[WorkspaceView, string, NavIcon]> = [
    ["rooms", "房间管理", "building"],
    ["system", "关于系统", "info"],
    ...(user.role === "admin"
      ? ([
          ["data", "数据管理", "database"],
          ["users", "账号管理", "users"],
        ] as Array<[WorkspaceView, string, NavIcon]>)
      : []),
    ["logs", "操作日志", "book"],
  ];

  function navigate(view: WorkspaceView) {
    persistWorkspaceView(view);
    dispatch({ type: "navigate", view });
    dispatch({ type: "set-settings", expanded: false });
    setMobileNavigationOpen(false);
  }

  function openProjectHome() {
    window.location.assign("/");
  }

  async function signOut() {
    await logout.mutateAsync();
    window.dispatchEvent(new CustomEvent("cageledger:session-changed"));
  }

  const items: MenuProps["items"] = [
    item("project-home", "主页", <HomeOutlined />),
    item("dashboard", "总览", <DashboardOutlined />),
    {
      key: "intake",
      icon: <TagsOutlined />,
      label: "笼卡管理",
      children: [
        item("intake-entry", "预约消息识别", <TagsOutlined />),
        item("intake-batches", "待接收批次", <BookOutlined />),
        item("cage-card-scanner", "二维码扫描", <QrcodeOutlined />),
      ],
    },
    item("cages", "笼位管理", <AppstoreOutlined />),
    {
      key: "animal",
      icon: <AuditOutlined />,
      label: "动物管理",
      children: [
        item("animal-inspection-entry", "动物巡检", <AuditOutlined />),
        item("animal-inspection-findings", "异常处置", <ReloadOutlined />),
        item("animal-inspection-records", "巡检记录", <BookOutlined />),
        item("animal-inspection-standards", "巡检标准", <InfoCircleOutlined />),
      ],
    },
    {
      key: "billing",
      icon: <CalculatorOutlined />,
      label: "饲养费管理",
      children: billingSidebarItems(user.role === "admin").map((entry) =>
        entry.section
          ? { type: "group" as const, key: `billing-section-${entry.section}`, label: entry.section }
          : item(entry.view!, entry.label!, iconFor[entry.icon!]),
      ),
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "系统设置",
      children: settingsViews.map(([view, label, icon]) => item(view, label, iconFor[icon])),
    },
  ];

  return (
    <Layout className={`ant-shell ${ui.sidebarCollapsed ? "ant-shell-collapsed" : ""}`} hasSider>
      <Layout.Sider
        aria-label="主导航"
        breakpoint="lg"
        className="ant-sidebar"
        collapsed={ui.sidebarCollapsed}
        collapsedWidth={64}
        theme="dark"
        trigger={null}
        width={248}
      >
        <div className="ant-brand">
          <img alt="" src="/cageledger-icon.svg" />
          <div className="ant-brand-copy">
            <strong>CageLedger</strong>
            <span>实验动物笼位管理与计费系统</span>
          </div>
          <Tooltip title={ui.sidebarCollapsed ? "展开导航栏" : "隐藏导航栏"}>
            <Button
              aria-label={ui.sidebarCollapsed ? "展开导航栏" : "隐藏导航栏"}
              className="ant-sidebar-collapse"
              icon={ui.sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              type="text"
              onClick={() => dispatch({ type: "toggle-sidebar" })}
            />
          </Tooltip>
        </div>
        <Menu
          className="ant-main-menu"
          inlineCollapsed={ui.sidebarCollapsed}
          items={items}
          mode="inline"
          selectedKeys={[ui.activeView]}
          theme="dark"
          onClick={({ key }) => {
            if (key === "project-home") {
              openProjectHome();
              return;
            }
            if (isWorkspaceView(key)) navigate(key);
          }}
        />
        <div className="ant-sidebar-account">
          <Typography.Text type="secondary">当前账号</Typography.Text>
          <Typography.Text strong>{user.displayName}</Typography.Text>
          <Typography.Text type="secondary">
            {user.role === "admin" ? "管理员 · 全部饲养间" : `房间管理员 · ${user.roomIds.length} 个饲养间`}
          </Typography.Text>
          <Space orientation="vertical" size={6}>
            <Button aria-label="刷新页面" block icon={<ReloadOutlined />} size="small" onClick={clearLocalCache}>
              刷新
            </Button>
            <Button
              aria-label="退出登录"
              block
              danger
              icon={<LogoutOutlined />}
              loading={logout.isPending}
              size="small"
              onClick={() => void signOut()}
            >
              退出
            </Button>
          </Space>
        </div>
      </Layout.Sider>
      <Layout className="ant-workspace-layout">
        <Layout.Content className="workspace ant-workspace">
          <WorkspaceErrorBoundary resetKey={ui.activeView}>
            <Suspense fallback={<WorkspaceLoading />}>{renderActiveView(ui.activeView, user, navigate)}</Suspense>
          </WorkspaceErrorBoundary>
          <footer className="workspace-footer ant-workspace-footer">
            <span>
              CageLedger {APP_VERSION}
              {systemInfo.data?.build ? `（${systemInfo.data.build}）` : ""}
            </span>
            <span>中山大学中山眼科中心 · 实验动物中心</span>
          </footer>
        </Layout.Content>
      </Layout>
      {isMobileLayout ? (
        <Suspense fallback={null}>
          <MobileNavigation
            activeView={ui.activeView}
            open={mobileNavigationOpen}
            settingsViews={settingsViews}
            user={user}
            onClose={() => setMobileNavigationOpen(false)}
            onNavigate={navigate}
            onOpen={() => setMobileNavigationOpen(true)}
            onOpenProjectHome={openProjectHome}
            onRefresh={clearLocalCache}
            onSignOut={() => void signOut()}
          />
        </Suspense>
      ) : null}
    </Layout>
  );
}

function item(key: string, label: string, icon: ReactNode): NonNullable<MenuProps["items"]>[number] {
  return { key, label, icon };
}

function renderActiveView(view: WorkspaceView, user: SessionUser, navigate: (view: WorkspaceView) => void) {
  if (view === "intake-entry") return <IntakeView mode="entry" user={user} navigate={navigate} />;
  if (view === "intake-batches") return <IntakeView mode="batches" user={user} navigate={navigate} />;
  if (view === "cage-card-scanner") return <ScannerView navigate={navigate} />;
  if (view === "cages") return <CagesView navigate={navigate} />;
  if (view === "animal-inspection-entry") return <AnimalManagementView mode="entry" user={user} navigate={navigate} />;
  if (view === "animal-inspection-findings")
    return <AnimalManagementView mode="findings" user={user} navigate={navigate} />;
  if (view === "animal-inspection-records")
    return <AnimalManagementView mode="records" user={user} navigate={navigate} />;
  if (view === "animal-inspection-standards")
    return <AnimalManagementView mode="standards" user={user} navigate={navigate} />;
  if (view === "billing-cage-map") return <BillingView mode="cage-map" user={user} navigate={navigate} />;
  if (view === "billing-quantity-entry") return <BillingView mode="quantity-entry" user={user} navigate={navigate} />;
  if (view === "billing-quantity-saved") return <BillingView mode="quantity-saved" user={user} navigate={navigate} />;
  if (view === "billing-settlement") return <BillingView mode="settlement" user={user} navigate={navigate} />;
  if (view === "billing-monthly-summary" && user.role === "admin")
    return <BillingView mode="monthly-summary" user={user} navigate={navigate} />;
  if (view === "workflow-center") return <WorkflowCenterView user={user} navigate={navigate} />;
  if (view === "rooms") return <RoomsView user={user} navigate={navigate} />;
  if (view === "users") return <UsersView currentUser={user} navigate={navigate} />;
  if (view === "data") return <DataView user={user} navigate={navigate} />;
  if (view === "logs") return <LogsView user={user} navigate={navigate} />;
  if (view === "system") return <SystemView user={user} navigate={navigate} />;
  return <DashboardView navigate={navigate} />;
}

function clearLocalCache() {
  clearUiStorage();
  window.location.reload();
}
