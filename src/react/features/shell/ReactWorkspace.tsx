import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import type { SessionUser } from "../../api/contracts";
import { useLogout } from "../../api/session";
import { useUiDispatch, useUiState, type WorkspaceView } from "../../state/ui";
import { clearUiStorage, persistWorkspaceView } from "../../state/uiStorage";
import { APP_VERSION } from "../../version";
import { DashboardView } from "../dashboard/DashboardView";

const IntakeView = lazy(() => import("../intake/IntakeView").then((module) => ({ default: module.IntakeView })));
const ScannerView = lazy(() => import("../scanner/ScannerView").then((module) => ({ default: module.ScannerView })));
const CagesView = lazy(() => import("../cages/CagesView").then((module) => ({ default: module.CagesView })));
const BillingView = lazy(() => import("../billing/BillingView").then((module) => ({ default: module.BillingView })));
const WorkflowCenterView = lazy(() =>
  import("../workflows/WorkflowCenterView").then((module) => ({ default: module.WorkflowCenterView })),
);
const RoomsView = lazy(() => import("../settings/RoomsView").then((module) => ({ default: module.RoomsView })));
const UsersView = lazy(() => import("../settings/UsersView").then((module) => ({ default: module.UsersView })));
const DataView = lazy(() => import("../settings/DataView").then((module) => ({ default: module.DataView })));
const LogsView = lazy(() => import("../settings/LogsView").then((module) => ({ default: module.LogsView })));
const SystemView = lazy(() => import("../settings/SystemView").then((module) => ({ default: module.SystemView })));

type IconName =
  | "home"
  | "tag"
  | "grid"
  | "calculator"
  | "refresh"
  | "settings"
  | "logout"
  | "building"
  | "info"
  | "database"
  | "users"
  | "book";

type NavigationDrawer = "intake" | "billing" | "settings";

export function ReactWorkspace({ user }: { user: SessionUser }) {
  const ui = useUiState();
  const dispatch = useUiDispatch();
  const logout = useLogout();
  const [activeDrawer, setActiveDrawer] = useState<NavigationDrawer | null>(null);
  const settingsViews: Array<[WorkspaceView, string, IconName, string]> = [
    ["rooms", "房间管理", "building", "维护饲养间、笼架和笼位基础结构。"],
    ["system", "关于系统", "info", "查看系统版本、更新状态、更新记录和系统 Wiki。"],
    ...(user.role === "admin"
      ? ([
          ["data", "数据管理", "database", "维护 IACUC 索引和外部数据源。"],
          ["users", "账号管理", "users", "维护系统管理员和房间管理员账号。"],
        ] as Array<[WorkspaceView, string, IconName, string]>)
      : []),
    ["logs", "操作日志", "book", "查看系统写入操作和审计记录。"],
  ];

  useEffect(() => {
    if (!activeDrawer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveDrawer(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeDrawer]);

  function navigate(view: WorkspaceView) {
    setActiveDrawer(null);
    persistActiveView(view);
    dispatch({ type: "navigate", view });
    dispatch({ type: "set-settings", expanded: false });
  }

  function toggleDrawer(drawer: NavigationDrawer, fallback: WorkspaceView) {
    if (ui.sidebarCollapsed && !usesCompactNavigation()) {
      navigate(fallback);
      return;
    }
    setActiveDrawer((current) => (current === drawer ? null : drawer));
  }

  async function signOut() {
    await logout.mutateAsync();
    window.dispatchEvent(new CustomEvent("cageledger:session-changed"));
  }

  return (
    <div
      className={`shell ${ui.sidebarCollapsed ? "sidebar-collapsed" : ""} ${activeDrawer ? "mobile-navigation-open" : ""}`}
    >
      {activeDrawer ? (
        <button
          className="mobile-navigation-backdrop"
          type="button"
          aria-label="关闭导航菜单"
          onClick={() => setActiveDrawer(null)}
        />
      ) : null}
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <div className="brand-mark">
              <img src="/cageledger-icon.svg" alt="" />
            </div>
            <div>
              <strong>CageLedger</strong>
              <span>实验动物笼位管理与计费系统</span>
            </div>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-group">
            <span className="nav-group-title">业务</span>
            <NavItem view="dashboard" label="主页" icon="home" activeView={ui.activeView} onNavigate={navigate} />
            <NavGroupButton
              label="笼卡管理"
              icon="tag"
              active={isIntakeView(ui.activeView)}
              expanded={activeDrawer === "intake"}
              controls="nav-intake"
              onClick={() => toggleDrawer("intake", "intake-entry")}
            />
            <NavigationSubmenu
              id="nav-intake"
              drawer="intake"
              expanded={activeDrawer === "intake"}
              showCurrent={activeDrawer === null}
              activeView={ui.activeView}
              settingsViews={settingsViews}
              user={user}
              logoutPending={logout.isPending}
              onClearCache={clearLocalCache}
              onSignOut={signOut}
              onNavigate={navigate}
            />
            <NavItem view="cages" label="笼位管理" icon="grid" activeView={ui.activeView} onNavigate={navigate} />
            <NavGroupButton
              label="饲养费管理"
              icon="calculator"
              active={isBillingView(ui.activeView)}
              expanded={activeDrawer === "billing"}
              controls="nav-billing"
              onClick={() => toggleDrawer("billing", "billing-quantity-entry")}
            />
            <NavigationSubmenu
              id="nav-billing"
              drawer="billing"
              expanded={activeDrawer === "billing"}
              showCurrent={activeDrawer === null}
              activeView={ui.activeView}
              settingsViews={settingsViews}
              user={user}
              logoutPending={logout.isPending}
              onClearCache={clearLocalCache}
              onSignOut={signOut}
              onNavigate={navigate}
            />
            <button
              className={`nav-item nav-item-settings-root ${isSettingsView(ui.activeView) ? "active" : ""}`}
              type="button"
              aria-label="系统设置"
              aria-expanded={activeDrawer === "settings"}
              aria-controls="nav-settings"
              onClick={() => toggleDrawer("settings", "rooms")}
            >
              <Icon name="settings" />
              <span>系统设置</span>
              <span className="nav-disclosure" aria-hidden="true">
                ›
              </span>
            </button>
            <NavigationSubmenu
              id="nav-settings"
              drawer="settings"
              expanded={activeDrawer === "settings"}
              showCurrent={activeDrawer === null}
              activeView={ui.activeView}
              settingsViews={settingsViews}
              user={user}
              logoutPending={logout.isPending}
              onClearCache={clearLocalCache}
              onSignOut={signOut}
              onNavigate={navigate}
            />
          </div>
        </nav>
        <div className="sidebar-account">
          <span>当前账号</span>
          <strong>{user.displayName}</strong>
          <small>
            {user.role === "admin" ? "管理员 · 全部饲养间" : `房间管理员 · ${user.roomIds.length} 个饲养间`}
          </small>
          <button className="secondary sidebar-cache-button" type="button" onClick={clearLocalCache}>
            刷新
          </button>
          <button className="secondary logout-button" type="button" disabled={logout.isPending} onClick={signOut}>
            <Icon name="logout" />
            退出
          </button>
          <VersionMeta className="sidebar-version" />
        </div>
      </aside>
      <button
        className="nav-toggle nav-toggle-rail"
        type="button"
        aria-label={ui.sidebarCollapsed ? "展开导航栏" : "隐藏导航栏"}
        onClick={() => dispatch({ type: "toggle-sidebar" })}
      >
        <span>{ui.sidebarCollapsed ? "展开" : "隐藏导航栏"}</span>
      </button>
      <main className="workspace">
        <WorkspaceErrorBoundary resetKey={ui.activeView}>
          <Suspense fallback={<WorkspaceLoading />}>{renderActiveView(ui.activeView, user, navigate)}</Suspense>
        </WorkspaceErrorBoundary>
        <footer className="workspace-footer">
          <VersionMeta className="workspace-version" />
        </footer>
      </main>
    </div>
  );
}

function renderActiveView(view: WorkspaceView, user: SessionUser, navigate: (view: WorkspaceView) => void) {
  if (view === "intake-entry") return <IntakeView mode="entry" user={user} navigate={navigate} />;
  if (view === "intake-batches") return <IntakeView mode="batches" user={user} navigate={navigate} />;
  if (view === "cage-card-scanner") return <ScannerView navigate={navigate} />;
  if (view === "cages") return <CagesView navigate={navigate} />;
  if (view === "billing-cage-map") return <BillingView mode="cage-map" user={user} navigate={navigate} />;
  if (view === "billing-quantity-entry") return <BillingView mode="quantity-entry" user={user} navigate={navigate} />;
  if (view === "billing-quantity-saved") return <BillingView mode="quantity-saved" user={user} navigate={navigate} />;
  if (view === "billing-settlement") return <BillingView mode="settlement" user={user} navigate={navigate} />;
  if (view === "workflow-center") return <WorkflowCenterView user={user} navigate={navigate} />;
  if (view === "rooms") return <RoomsView user={user} navigate={navigate} />;
  if (view === "users") return <UsersView currentUser={user} navigate={navigate} />;
  if (view === "data") return <DataView user={user} navigate={navigate} />;
  if (view === "logs") return <LogsView user={user} navigate={navigate} />;
  if (view === "system") return <SystemView user={user} navigate={navigate} />;
  return <DashboardView navigate={navigate} />;
}

function NavItem({
  view,
  label,
  icon,
  activeView,
  onNavigate,
}: {
  view: WorkspaceView;
  label: string;
  icon: IconName;
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
}) {
  return (
    <button
      className={`nav-item ${activeView === view ? "active" : ""}`}
      type="button"
      aria-label={label}
      aria-current={activeView === view ? "page" : undefined}
      onClick={() => onNavigate(view)}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function NavGroupButton({
  label,
  icon,
  active,
  expanded,
  controls,
  onClick,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item nav-group-button ${active ? "active" : ""}`}
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{label}</span>
      <span className="nav-disclosure" aria-hidden="true">
        {expanded ? "‹" : "›"}
      </span>
    </button>
  );
}

function NavigationSubmenu({
  id,
  drawer,
  expanded,
  showCurrent,
  activeView,
  settingsViews,
  user,
  logoutPending,
  onClearCache,
  onSignOut,
  onNavigate,
}: {
  id: string;
  drawer: NavigationDrawer;
  expanded: boolean;
  showCurrent: boolean;
  activeView: WorkspaceView;
  settingsViews: Array<[WorkspaceView, string, IconName, string]>;
  user: SessionUser;
  logoutPending: boolean;
  onClearCache: () => void;
  onSignOut: () => Promise<void>;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const groupIsActive =
    drawer === "intake"
      ? isIntakeView(activeView)
      : drawer === "billing"
        ? isBillingView(activeView)
        : isSettingsView(activeView);
  return (
    <div
      id={id}
      className={`nav-subtree navigation-submenu ${expanded ? "expanded" : ""} ${showCurrent && groupIsActive ? "current-group" : ""}`}
      aria-label={`${drawer === "intake" ? "笼卡管理" : drawer === "billing" ? "饲养费管理" : "系统设置"}子菜单`}
    >
      {drawer === "intake" ? (
        <>
          <NavigationPanelItem
            view="intake-entry"
            label="预约消息识别"
            description="预约信息录入与笼卡扫码查询"
            icon="tag"
            activeView={activeView}
            onNavigate={onNavigate}
          />
          <NavigationPanelItem
            view="intake-batches"
            label="待接收批次"
            description="打印、接收和维护已保存批次"
            icon="book"
            activeView={activeView}
            onNavigate={onNavigate}
          />
          <NavigationPanelItem
            view="cage-card-scanner"
            label="二维码扫描"
            description="扫描笼卡二维码查询当前信息"
            icon="grid"
            activeView={activeView}
            onNavigate={onNavigate}
          />
        </>
      ) : null}
      {drawer === "billing" ? (
        <>
          <span className="nav-submenu-label">核算数据</span>
          <NavigationPanelItem
            view="billing-cage-map"
            label="动态笼位图（自动）"
            description="按真实占用时间线自动核算"
            icon="grid"
            activeView={activeView}
            onNavigate={onNavigate}
          />
          <span className="nav-submenu-label">数量统计表</span>
          <NavigationPanelItem
            view="billing-quantity-entry"
            label="数量统计表（录入）"
            description="按伦理号和房间录入月度变化"
            icon="calculator"
            activeView={activeView}
            onNavigate={onNavigate}
          />
          <NavigationPanelItem
            view="billing-quantity-saved"
            label="已保存数量统计表"
            description="检索、预览和维护历史统计表"
            icon="book"
            activeView={activeView}
            onNavigate={onNavigate}
          />
          <span className="nav-submenu-label">结算管理</span>
          <NavigationPanelItem
            view="billing-settlement"
            label="按项目负责人结算"
            description="自动合并负责人名下伦理并出单"
            icon="calculator"
            activeView={activeView}
            onNavigate={onNavigate}
          />
          <NavigationPanelItem
            view="workflow-center"
            label="结算与报销台账"
            description="跟踪结算流程、报销和累计未缴"
            icon="refresh"
            activeView={activeView}
            onNavigate={onNavigate}
          />
        </>
      ) : null}
      {drawer === "settings" ? (
        <>
          {settingsViews.map(([view, label, icon, itemDescription]) => (
            <NavigationPanelItem
              key={view}
              view={view}
              label={label}
              description={itemDescription}
              icon={icon}
              activeView={activeView}
              onNavigate={onNavigate}
            />
          ))}
          <div className="mobile-account-actions" aria-label="账户操作">
            <span>{user.displayName}</span>
            <button className="secondary" type="button" onClick={onClearCache}>
              <Icon name="refresh" />
              刷新页面
            </button>
            <button className="secondary logout-button" type="button" disabled={logoutPending} onClick={onSignOut}>
              <Icon name="logout" />
              退出登录
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function NavigationPanelItem({
  view,
  label,
  description,
  icon,
  activeView,
  onNavigate,
}: {
  view: WorkspaceView;
  label: string;
  description: string;
  icon: IconName;
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
}) {
  return (
    <button
      className={`settings-drawer-item ${activeView === view ? "active" : ""}`}
      type="button"
      aria-current={activeView === view ? "page" : undefined}
      onClick={() => onNavigate(view)}
    >
      <Icon name={icon} />
      <span>{label}</span>
      <small className="sr-only">{description}</small>
    </button>
  );
}

function isIntakeView(view: WorkspaceView) {
  return view === "intake-entry" || view === "intake-batches" || view === "cage-card-scanner";
}

function isQuantityView(view: WorkspaceView) {
  return view === "billing-quantity-entry" || view === "billing-quantity-saved";
}

function isBillingView(view: WorkspaceView) {
  return (
    view === "billing-cage-map" || isQuantityView(view) || view === "billing-settlement" || view === "workflow-center"
  );
}

function isSettingsView(view: WorkspaceView) {
  return view === "rooms" || view === "data" || view === "system" || view === "users" || view === "logs";
}

function usesCompactNavigation() {
  return window.matchMedia("(max-width: 760px), (max-height: 560px)").matches;
}

function WorkspaceLoading() {
  return (
    <section className="workspace-view">
      <div className="empty-state" aria-busy="true">
        <strong>正在加载业务工作区...</strong>
      </div>
    </section>
  );
}

const CHUNK_RECOVERY_KEY = "cageledger.workspace.chunk-recovery-at";
const CHUNK_RECOVERY_WINDOW_MS = 30_000;

class WorkspaceErrorBoundary extends Component<
  { children: ReactNode; resetKey: WorkspaceView },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!isChunkLoadFailure(error)) return;

    const lastRecoveryAt = Number(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || 0);
    if (Date.now() - lastRecoveryAt < CHUNK_RECOVERY_WINDOW_MS) return;

    sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(Date.now()));
    window.location.reload();
  }

  componentDidUpdate(previousProps: Readonly<{ children: ReactNode; resetKey: WorkspaceView }>) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="workspace-view">
        <div className="empty-state" role="alert">
          <strong>当前工作区未能加载</strong>
          <span>页面资源可能刚完成更新，请重新加载后继续操作。</span>
          <div className="action-row">
            <button className="secondary" type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => {
                clearUiStorage();
                sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
                window.location.assign("/");
              }}
            >
              返回首页
            </button>
          </div>
        </div>
      </section>
    );
  }
}

function isChunkLoadFailure(error: Error) {
  return /chunkloaderror|loading chunk|dynamically imported module|module script/i.test(error.message);
}

function VersionMeta({ className }: { className: string }) {
  return (
    <div className={`version-meta ${className}`}>
      <span>CageLedger v{APP_VERSION}</span>
      <small>中山大学中山眼科中心 · 实验动物中心</small>
      <small>© 2026 中山大学中山眼科中心 实验动物中心. Licensed under Apache-2.0.</small>
    </div>
  );
}

function persistActiveView(view: WorkspaceView) {
  persistWorkspaceView(view);
}

function clearLocalCache() {
  clearUiStorage();
  window.location.reload();
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    home: "M4 11 12 4l8 7v9h-5v-6H9v6H4z",
    tag: "M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9zm5-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
    grid: "M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z",
    calculator:
      "M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 2v4h8V5zm0 7v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zM8 16v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2z",
    refresh: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3z",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4-2.1-1.2.2-2.4-2.3-1.3-1.8 1.6-2.2-.9-.5-2.4H9.5L9 7.8l-2.2.9L5 7.1 2.7 8.4l.2 2.4L1 12l1.9 1.2-.2 2.4L5 16.9l1.8-1.6 2.2.9.5 2.4h2.6l.5-2.4 2.2-.9 1.8 1.6 2.3-1.3-.2-2.4z",
    logout: "M10 4H4v16h6v-2H6V6h4zm5 3-1.4 1.4 2.6 2.6H9v2h7.2l-2.6 2.6L15 17l5-5z",
    building:
      "M4 21V5l8-3 8 3v16h-6v-5h-4v5zm3-3h2v-2H7zm0-4h2v-2H7zm0-4h2V8H7zm4 4h2v-2h-2zm0-4h2V8h-2zm4 4h2v-2h-2zm0-4h2V8h-2z",
    info: "M11 10h2v8h-2zm0-4h2v2h-2zm1-4a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
    database:
      "M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zm0 2C8.2 5 6 6 6 6s2.2 1 6 1 6-1 6-1-2.2-1-6-1zM6 9v3c.8.5 2.9 1 6 1s5.2-.5 6-1V9c-1.4.6-3.5 1-6 1S7.4 9.6 6 9zm0 6v3c.8.5 2.9 1 6 1s5.2-.5 6-1v-3c-1.4.6-3.5 1-6 1s-4.6-.4-6-1z",
    users:
      "M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4zm7.5-9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 8c-.7 0-1.4.1-2 .3 1.6 1 2.5 2.6 2.5 4.7v2h4v-2c0-2.8-2-5-4.5-5z",
    book: "M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5zm2.5-.5a.5.5 0 0 0-.5.5v13.1c.2-.1.3-.1.5-.1H18V4zM9 7h6v2H9zm0 4h6v2H9z",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
