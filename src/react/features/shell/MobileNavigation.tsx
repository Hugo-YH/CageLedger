import {
  AppstoreOutlined,
  AuditOutlined,
  BookOutlined,
  CalculatorOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  EditOutlined,
  HomeOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  ShopOutlined,
  TagsOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Button as MobileButton, List, Popup, TabBar } from "antd-mobile";
import { useEffect, type ReactNode } from "react";

import type { SessionUser } from "../../api/contracts";
import type { WorkspaceView } from "../../state/ui";
import { billingSidebarItems } from "./workspaceNavigation";

type NavIcon =
  "tag" | "grid" | "calculator" | "refresh" | "book" | "clipboard" | "building" | "info" | "database" | "users";

const navIcon: Record<NavIcon, ReactNode> = {
  tag: <TagsOutlined />,
  grid: <AppstoreOutlined />,
  calculator: <CalculatorOutlined />,
  refresh: <ReloadOutlined />,
  book: <BookOutlined />,
  clipboard: <UnorderedListOutlined />,
  building: <ShopOutlined />,
  info: <InfoCircleOutlined />,
  database: <DatabaseOutlined />,
  users: <TeamOutlined />,
};

const billingIcon: Record<string, ReactNode> = {
  grid: <AppstoreOutlined />,
  calculator: <CalculatorOutlined />,
  book: <BookOutlined />,
};

export function MobileNavigation({
  activeView,
  open,
  settingsViews,
  user,
  onClose,
  onNavigate,
  onOpen,
  onOpenProjectHome,
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
  onOpenProjectHome: () => void;
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
        <TabBar
          activeKey={activeKey}
          onChange={(key) => {
            const destination = mobileTabDestination(key);
            if (destination) {
              onNavigate(destination);
              return;
            }
            onOpen();
          }}
        >
          <TabBar.Item
            icon={<DashboardOutlined />}
            key="dashboard"
            title={mobileTabTitle("总览", activeKey === "dashboard")}
          />
          <TabBar.Item icon={<AuditOutlined />} key="animal" title={mobileTabTitle("动物", activeKey === "animal")} />
          <TabBar.Item icon={<AppstoreOutlined />} key="more" title={mobileTabTitle("更多", false)} />
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
            <div>
              <strong>全部功能</strong>
              <span className="ant-mobile-sheet-subtitle">按业务分组快速切换</span>
            </div>
            <MobileButton fill="none" onClick={onClose} size="mini">
              关闭
            </MobileButton>
          </div>
          <div className="ant-mobile-sheet-scroll">
            <List header="项目门户">
              <List.Item arrow prefix={<HomeOutlined />} onClick={onOpenProjectHome}>
                主页
              </List.Item>
            </List>
            <List header="笼卡管理">
              <MenuItem icon={<EditOutlined />} label="预约消息识别" view="intake-entry" onNavigate={onNavigate} />
              <MenuItem icon={<InboxOutlined />} label="待接收批次" view="intake-batches" onNavigate={onNavigate} />
              <MenuItem icon={<QrcodeOutlined />} label="二维码扫描" view="cage-card-scanner" onNavigate={onNavigate} />
            </List>
            <List header="笼位管理">
              <MenuItem icon={<AppstoreOutlined />} label="动态笼位图" view="cages" onNavigate={onNavigate} />
            </List>
            <List header="动物管理">
              <MenuItem
                icon={<AuditOutlined />}
                label="动物巡检"
                view="animal-inspection-entry"
                onNavigate={onNavigate}
              />
              <MenuItem
                icon={<WarningOutlined />}
                label="异常处置"
                view="animal-inspection-findings"
                onNavigate={onNavigate}
              />
              <MenuItem
                icon={<UnorderedListOutlined />}
                label="巡检记录"
                view="animal-inspection-records"
                onNavigate={onNavigate}
              />
              <MenuItem
                icon={<BookOutlined />}
                label="巡检标准"
                view="animal-inspection-standards"
                onNavigate={onNavigate}
              />
            </List>
            <List header="饲养费管理">
              {billingSidebarItems(user.role === "admin").flatMap((entry) =>
                entry.view
                  ? [
                      <MenuItem
                        icon={billingIcon[entry.icon || ""] || <CalculatorOutlined />}
                        key={entry.view}
                        label={entry.label!}
                        onNavigate={onNavigate}
                        view={entry.view}
                      />,
                    ]
                  : [],
              )}
            </List>
            <List header="系统设置">
              {settingsViews.map(([view, label, icon]) => (
                <MenuItem key={view} icon={navIcon[icon]} label={label} onNavigate={onNavigate} view={view} />
              ))}
            </List>
          </div>
          <div className="ant-mobile-sheet-actions">
            <MobileButton block fill="outline" onClick={onRefresh}>
              刷新页面
            </MobileButton>
            <MobileButton block color="danger" fill="outline" onClick={onSignOut}>
              退出登录
            </MobileButton>
          </div>
        </div>
      </Popup>
    </>
  );
}

function MenuItem({
  icon,
  label,
  view,
  onNavigate,
}: {
  icon: ReactNode;
  label: string;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
}) {
  return (
    <List.Item arrow prefix={icon} onClick={() => onNavigate(view)}>
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

function mobileKey(view: WorkspaceView) {
  if (view === "dashboard") return "dashboard";
  if (isAnimalManagementView(view)) return "animal";
  return "none";
}

function isAnimalManagementView(view: WorkspaceView) {
  return view.startsWith("animal-inspection-");
}

function mobileTabDestination(key: string): WorkspaceView | null {
  const destinations: Record<string, WorkspaceView> = {
    dashboard: "dashboard",
    animal: "animal-inspection-entry",
  };
  return destinations[key] ?? null;
}
