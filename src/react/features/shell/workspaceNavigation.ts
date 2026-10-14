import type { WorkspaceView } from "../../state/ui";

export type BillingSidebarItem = {
  section?: string;
  view?: WorkspaceView;
  label?: string;
  description?: string;
  icon?: "grid" | "calculator" | "book" | "refresh";
  dataUi?: string;
};

export function isWorkspaceView(value: string): value is WorkspaceView {
  return [
    "dashboard",
    "quarantine-batches",
    "quarantine-parasite",
    "quarantine-elisa",
    "quarantine-pcr",
    "quarantine-reports",
    "cages",
    "intake-entry",
    "intake-batches",
    "cage-card-scanner",
    "animal-inspection-entry",
    "animal-inspection-findings",
    "animal-inspection-records",
    "animal-inspection-standards",
    "technical-service-entry",
    "technical-service-saved",
    "technical-service-settlement",
    "billing-cage-map",
    "billing-quantity-entry",
    "billing-quantity-saved",
    "billing-settlement",
    "billing-monthly-summary",
    "workflow-center",
    "feedback",
    "rooms",
    "data",
    "system",
    "users",
    "logs",
  ].includes(value);
}

export function billingSidebarItems(): BillingSidebarItem[] {
  return [
    {
      view: "billing-quantity-entry",
      label: "录入数量统计表",
      description: "按伦理号和房间录入月度变化",
      icon: "calculator",
      dataUi: "nav-billing-quantity-entry",
    },
    {
      view: "billing-quantity-saved",
      label: "已保存数量统计表",
      description: "检索、预览和维护历史统计表",
      icon: "book",
      dataUi: "nav-billing-quantity-saved",
    },
  ];
}

export function settlementSidebarItems(canExportMonthlySummary: boolean): BillingSidebarItem[] {
  const items: BillingSidebarItem[] = [
    {
      view: "billing-settlement",
      label: "结算列表",
      description: "自动合并负责人名下伦理并出单",
      icon: "calculator",
      dataUi: "nav-billing-settlement",
    },
    {
      view: "workflow-center",
      label: "单据跟踪",
      description: "跟踪结算流程、报销和累计未缴",
      icon: "refresh",
      dataUi: "nav-workflow-center",
    },
  ];
  if (canExportMonthlySummary) {
    items.push({
      view: "billing-monthly-summary",
      label: "汇总导出",
      description: "导出 IACUC 和设施维度的月度 Excel",
      icon: "book",
      dataUi: "nav-billing-monthly-summary",
    });
  }
  return items;
}

export function technicalServiceSidebarItems(): BillingSidebarItem[] {
  return [
    {
      view: "technical-service-entry",
      label: "录入技术服务明细",
      icon: "calculator",
      dataUi: "nav-technical-service-entry",
    },
    {
      view: "technical-service-saved",
      label: "已保存技术服务明细",
      icon: "book",
      dataUi: "nav-technical-service-saved",
    },
  ];
}
