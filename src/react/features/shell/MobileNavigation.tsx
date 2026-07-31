import {
  AppstoreOutlined,
  AuditOutlined,
  CalculatorOutlined,
  HomeOutlined,
  LogoutOutlined,
  ReloadOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import { List, Popup, TabBar } from "antd-mobile";
import { useEffect } from "react";

import type { SessionUser } from "../../api/contracts";
import type { WorkspaceView } from "../../state/ui";
import { billingSidebarItems, isWorkspaceView } from "./workspaceNavigation";

type NavIcon =
  "tag" | "grid" | "calculator" | "refresh" | "book" | "clipboard" | "building" | "info" | "database" | "users";

export function MobileNavigation({
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

function mobileKey(view: WorkspaceView) {
  if (isIntakeView(view)) return "intake";
  if (isAnimalManagementView(view)) return "animal";
  if (isBillingView(view)) return "billing";
  if (isSettingsView(view)) return "more";
  return view;
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
