import type { WorkspaceView } from "../../state/ui";
import type { WorkspaceBreadcrumbItem, WorkspaceSwitcherItem } from "../../components/WorkspaceUi";

type Navigator = (view: WorkspaceView) => void;

export function breadcrumb(label: string, onClick?: () => void): WorkspaceBreadcrumbItem {
  return { label, onClick };
}

export function intakeSwitchItems(navigate: Navigator): WorkspaceSwitcherItem[] {
  return [
    { label: "预约消息识别", description: "识别预约消息并录入待接收批次", onClick: () => navigate("intake-entry") },
    { label: "待接收批次", description: "打印、接收和维护已保存批次", onClick: () => navigate("intake-batches") },
    { label: "二维码扫描", description: "扫描笼卡二维码查询笼卡信息", onClick: () => navigate("cage-card-scanner") },
  ];
}

export function billingSwitchItems(navigate: Navigator): WorkspaceSwitcherItem[] {
  return [
    {
      label: "动态笼位图（自动）",
      description: "按真实占用时间线自动核算",
      onClick: () => navigate("billing-cage-map"),
    },
    {
      label: "数量统计表（录入）",
      description: "按伦理号和房间录入月度变化",
      onClick: () => navigate("billing-quantity-entry"),
    },
    {
      label: "已保存数量统计表",
      description: "检索、预览和维护历史统计表",
      onClick: () => navigate("billing-quantity-saved"),
    },
    {
      label: "按项目负责人结算",
      description: "自动合并负责人名下伦理并出单",
      onClick: () => navigate("billing-settlement"),
    },
    {
      label: "结算与报销台账",
      description: "跟踪结算流程、报销和累计未缴",
      onClick: () => navigate("workflow-center"),
    },
  ];
}

export function coreSwitchItems(navigate: Navigator): WorkspaceSwitcherItem[] {
  return [
    { label: "主页", description: "返回运营总览", onClick: () => navigate("dashboard") },
    { label: "笼卡管理", description: "接收、待接收和二维码扫描", onClick: () => navigate("intake-entry") },
    { label: "笼位管理", description: "动态笼位图和占用维护", onClick: () => navigate("cages") },
    {
      label: "饲养费管理",
      description: "数量统计表和项目负责人结算",
      onClick: () => navigate("billing-quantity-entry"),
    },
    { label: "系统设置", description: "房间、数据和账号管理", onClick: () => navigate("rooms") },
  ];
}

export function settingsSwitchItems(navigate: Navigator, canSeeAdmin: boolean): WorkspaceSwitcherItem[] {
  const items: WorkspaceSwitcherItem[] = [
    { label: "房间管理", description: "维护饲养间、笼架和笼位基础结构", onClick: () => navigate("rooms") },
    { label: "关于系统", description: "查看版本、更新和正式文档入口", onClick: () => navigate("system") },
  ];
  if (canSeeAdmin) {
    items.splice(
      1,
      0,
      { label: "数据管理", description: "维护 IACUC 索引和历史台账导入", onClick: () => navigate("data") },
      { label: "账号管理", description: "维护系统管理员和房间管理员账号", onClick: () => navigate("users") },
    );
  }
  items.push({ label: "操作日志", description: "查看系统写入操作和审计记录", onClick: () => navigate("logs") });
  return items;
}
