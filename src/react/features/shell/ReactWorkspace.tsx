import {
  AppstoreOutlined,
  AuditOutlined,
  BookOutlined,
  CalculatorOutlined,
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
import { List, Popup, TabBar } from "antd-mobile";
import { lazy, Suspense, type ReactNode, useEffect, useState } from "react";

import type { SessionUser } from "../../api/contracts";
import { useLogout } from "../../api/session";
import { clearUiStorage, persistWorkspaceView } from "../../state/uiStorage";
import { useUiDispatch, useUiState, type WorkspaceView } from "../../state/ui";
import { APP_VERSION } from "../../version";
import { WorkspaceErrorBoundary, WorkspaceLoading } from "./WorkspaceErrorBoundary";
import { billingSidebarItems } from "./workspaceNavigation";
import { DashboardView } from "../dashboard/DashboardView";

const IntakeView = lazy(() => import("../intake/IntakeView").then((module) => ({ default: module.IntakeView })));
const ScannerView = lazy(() => import("../scanner/ScannerView").then((module) => ({ default: module.ScannerView })));
const CagesView = lazy(() => import("../cages/CagesView").then((module) => ({ default: module.CagesView })));
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
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

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

  async function signOut() {
    await logout.mutateAsync();
    window.dispatchEvent(new CustomEvent("cageledger:session-changed"));
  }

  const items: MenuProps["items"] = [
    item("dashboard", "主页", <HomeOutlined />),
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
            <span>CageLedger v{APP_VERSION}</span>
            <span>中山大学中山眼科中心 · 实验动物中心</span>
          </footer>
        </Layout.Content>
      </Layout>
      <MobileNavigation
        activeView={ui.activeView}
        open={mobileNavigationOpen}
        settingsViews={settingsViews}
        user={user}
        onClose={() => setMobileNavigationOpen(false)}
        onNavigate={navigate}
        onOpen={() => setMobileNavigationOpen(true)}
        onRefresh={clearLocalCache}
        onSignOut={() => void signOut()}
      />
    </Layout>
  );
}

function MobileNavigation({
  activeView,
  open,
  settingsViews,
  user,
  onClose,
  onNavigate,
  onOpen,
  onRefresh,
  onSignOut,
}: {
  activeView: WorkspaceView;
  open: boolean;
  settingsViews: Array<[WorkspaceView, string, NavIcon]>;
  user: SessionUser;
  onClose: () => void;
  onNavigate: (view: WorkspaceView) => void;
  onOpen: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const activeKey = mobileKey(activeView);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  return (
    <>
      <div className="ant-mobile-tabbar" aria-label="移动端主导航" role="tablist">
        <TabBar activeKey={activeKey} onChange={(key) => (isWorkspaceView(key) ? onNavigate(key) : onOpen())}>
          <TabBar.Item
            icon={<HomeOutlined />}
            key="dashboard"
            title={mobileTabTitle("主页", activeKey === "dashboard")}
          />
          <TabBar.Item icon={<TagsOutlined />} key="intake" title={mobileTabTitle("笼卡", activeKey === "intake")} />
          <TabBar.Item icon={<AppstoreOutlined />} key="cages" title={mobileTabTitle("笼位", activeKey === "cages")} />
          <TabBar.Item icon={<AuditOutlined />} key="animal" title={mobileTabTitle("动物", activeKey === "animal")} />
          <TabBar.Item
            icon={<CalculatorOutlined />}
            key="billing"
            title={mobileTabTitle("饲养费", activeKey === "billing")}
          />
          <TabBar.Item icon={<AppstoreOutlined />} key="more" title={mobileTabTitle("更多", activeKey === "more")} />
        </TabBar>
      </div>
      <Popup
        bodyStyle={{ borderRadius: "16px 16px 0 0" }}
        destroyOnClose
        position="bottom"
        visible={open}
        onClose={onClose}
        onMaskClick={onClose}
      >
        <div className="ant-mobile-navigation-sheet">
          <div className="ant-mobile-sheet-head">
            <strong>全部功能</strong>
            <Button size="small" type="text" onClick={onClose}>
              关闭
            </Button>
          </div>
          <List header="笼卡管理">
            <MobileItem label="预约消息识别" view="intake-entry" onNavigate={onNavigate} />
            <MobileItem label="待接收批次" view="intake-batches" onNavigate={onNavigate} />
            <MobileItem label="二维码扫描" view="cage-card-scanner" onNavigate={onNavigate} />
          </List>
          <List header="动物管理">
            <MobileItem label="动物巡检" view="animal-inspection-entry" onNavigate={onNavigate} />
            <MobileItem label="异常处置" view="animal-inspection-findings" onNavigate={onNavigate} />
            <MobileItem label="巡检记录" view="animal-inspection-records" onNavigate={onNavigate} />
            <MobileItem label="巡检标准" view="animal-inspection-standards" onNavigate={onNavigate} />
          </List>
          <List header="饲养费管理">
            {billingSidebarItems(user.role === "admin").flatMap((entry) =>
              entry.view
                ? [<MobileItem key={entry.view} label={entry.label!} view={entry.view} onNavigate={onNavigate} />]
                : [],
            )}
          </List>
          <List header="系统设置">
            {settingsViews.map(([view, label]) => (
              <MobileItem key={view} label={label} view={view} onNavigate={onNavigate} />
            ))}
          </List>
          <div className="ant-mobile-sheet-actions">
            <Button aria-label="刷新页面" block icon={<ReloadOutlined />} onClick={onRefresh}>
              刷新页面
            </Button>
            <Button aria-label="退出登录" block danger icon={<LogoutOutlined />} onClick={onSignOut}>
              退出登录
            </Button>
          </div>
        </div>
      </Popup>
    </>
  );
}

function MobileItem({
  label,
  view,
  onNavigate,
}: {
  label: string;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
}) {
  return (
    <List.Item arrow onClick={() => onNavigate(view)}>
      {label}
    </List.Item>
  );
}

function mobileTabTitle(label: string, active: boolean) {
  return (
    <span aria-label={label} aria-selected={active} role="tab">
      {label}
    </span>
  );
}

function item(key: WorkspaceView, label: string, icon: ReactNode): NonNullable<MenuProps["items"]>[number] {
  return { key, label, icon };
}

function mobileKey(view: WorkspaceView) {
  if (isIntakeView(view)) return "intake";
  if (isAnimalManagementView(view)) return "animal";
  if (isBillingView(view)) return "billing";
  if (isSettingsView(view)) return "more";
  return view;
}

function isWorkspaceView(value: string): value is WorkspaceView {
  return [
    "dashboard",
    "cages",
    "intake-entry",
    "intake-batches",
    "cage-card-scanner",
    "animal-inspection-entry",
    "animal-inspection-findings",
    "animal-inspection-records",
    "animal-inspection-standards",
    "billing-cage-map",
    "billing-quantity-entry",
    "billing-quantity-saved",
    "billing-settlement",
    "billing-monthly-summary",
    "workflow-center",
    "rooms",
    "data",
    "system",
    "users",
    "logs",
  ].includes(value);
}

function isIntakeView(view: WorkspaceView) {
  return view === "intake-entry" || view === "intake-batches" || view === "cage-card-scanner";
}
function isBillingView(view: WorkspaceView) {
  return view.startsWith("billing-") || view === "workflow-center";
}
function isAnimalManagementView(view: WorkspaceView) {
  return view.startsWith("animal-inspection-");
}
function isSettingsView(view: WorkspaceView) {
  return view === "rooms" || view === "data" || view === "system" || view === "users" || view === "logs";
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
